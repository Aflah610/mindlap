# Mindlap security review

Date: 25 October 2026. Reviewer: Codex.
Status: review complete for the scope below; findings remain open. No fixes deployed.

## Scope and limits

Reviewed the website, booking JavaScript, Cloudflare Worker, booking app login,
permissions, client and clinical access, booking/payment routes, webhooks, public
API, database connection configuration, container/deployment files and CI.
Website HEAD at start: `e52798b`; booking app HEAD: `cda3947`.

Performed public HTTP HEAD checks and offline probes with synthetic data. No
client records, production database, credentials or live payments were accessed.
No authenticated production penetration test or load test was performed. Local
account-page edits and personal PDFs were left untouched. No AWS/Cloudflare/Meta/
Zoho account configuration, server patch level, IAM, database network rules,
backup contents or restore capability was independently verified. MCH and the
other legacy services were not audited. This is not a certification of the whole
operating environment or evidence that any vulnerability has been exploited.

## Priorities

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| S1 | High | Staff management can take over an existing admin login | Offline action probe and source |
| S2 | High | Booking mutations bypass the booking permission | Offline cancellation probe and source |
| S3 | High | Failed payment capture still confirms paid bookings/credits | Offline Worker probe and source |
| S4 | Medium | Clinical permission removal does not revoke assigned-therapist access | Offline access probe and source |
| S5 | Medium | Client search ignores contact permission | Offline route probe and source |
| S6 | Medium | Workflow webhooks accept internal network destinations | Offline schema probe and source |
| S7 | Medium | Booking app lacks browser security headers | Live login response and configuration |

Priority reflects impact in this project, not a calculated CVSS score. Fix S1-S3
before importing further clinical records or expanding access to staff. Add
regression tests for each fix before publishing it.

## S1: manager can change an existing admin's login identity

Booking app: `src/app/admin/actions.ts:44-64`,
`src/features/staff/staff.service.ts:48-65,116-128`, and `src/auth.ts:35-49`.
Managers have `staff.manage` by default. `updateStaffAction` blocks changing an
admin's role, but allows editing the admin's email while leaving the role as
`admin`. Login resolves identity by that email. A manager could replace it with
an unused address they control, then use an enabled OAuth provider or password
reset to enter the admin account. The configured email-domain restriction, if
any, constrains which address can be used; it does not protect the edit itself.
The same path also allows deactivating an existing admin.

The offline probe invoked the real action with an authorised manager fixture,
unchanged admin role and a synthetic new email; it reached the update call.
No real account or email was changed.

Fix: reject all non-admin modifications to admin accounts before processing any
fields. Guard privilege-bearing identity changes centrally, and require an admin
or verified identity-change flow for login email changes. Test role-preserving
email edits, deactivation, direct action calls and permitted ordinary staff edits.

## S2: booking access is treated as permission to mutate money and bookings

Booking app: `src/app/admin/bookings/actions.ts:12-18,46-111`.
`requireBookingAccess` accepts anyone with `bookings.all`, or the psychologist
assigned to the booking. It does not require `bookings.create`. The same helper
protects rescheduling, cancellation, payment-status changes, credit use and manual
payment recording. Therefore a psychologist can mutate their own bookings and
financial state, and a manager can mutate all bookings, despite lacking the
booking permission by default. Services receive `mode: "staff"`, not a permission
set that would reject these callers. Creating a new booking has the correct
separate permission check.

The offline cancellation probe reached the service for a psychologist fixture
whose booking-permission check would reject them.

Fix: require the appropriate mutation permission as well as booking access.
Separate financial/payment adjustments from diary visibility; decide which
status and meeting-link operations clinicians should retain. Test all action
exports directly for psychologist, manager, CCD and custom permission sets.

## S3: capture failure becomes a successful paid result

Website Worker: `worker/src/waky.js:237-297,563-577`.
`finalizeWakyPayment` catches a failed capture of an `authorized` payment and
continues. `paymentReport` unconditionally sends `status: 'paid'`; package
purchase handling similarly proceeds. The offline probe made capture throw,
then observed a paid report and `status: 'booked'`. This is a financial-integrity
defect, not a demonstrated payment-signature bypass. Razorpay distinguishes
authorised from captured funds and automatically refunds uncaptured payments.
See [Razorpay payment capture documentation](https://razorpay.com/docs/payments/payments/capture-settings/).

The webhook also returns HTTP 200 when finalisation returns `error`, so failed
delivery to the booking app can be acknowledged without a confirmed result.
The Waky engine has no Worker sweep equivalent to the legacy reconciliation
path. Client retries may help but are not durable reconciliation.

Fix: only grant paid status or package value after confirming capture. When a
capture request fails, refetch payment state to handle concurrent capture safely;
otherwise retain pending status and retry. Persist/retry verified webhook events
or return a retryable failure until reconciliation is durable. Test capture
failure, already-captured races, booking-app outage and duplicate events.

## S4: clinical permission changes do not consistently enforce access

Booking app: `src/features/case-history/case-history.service.ts:17,36-47,92-124`
and `src/app/admin/case-histories/actions.ts`.
`canRead` grants access to the assigned therapist without checking that they
still hold clinical permissions. Direct case pages/actions require only signed-in
staff and this service check. Removing every permission hides menu/list access,
but the offline probe confirmed assigned-therapist access still returns true.
Write methods also reuse the read guard: granting `casenotes.read_all` can allow
intake edits and new notes rather than read-only access.

Fix: define separate clinical read and write policies, combining current
permissions with assignment. Enforce them inside every service entry point.
Test permission revocation on direct URLs/actions and read-only clinical roles.
This follows [OWASP's per-request authorisation guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

## S5: contact privacy is bypassed by the client search API

Booking app: `src/app/api/admin/clients/search/route.ts:10-19`.
The route checks `bookings.all` through `isFrontDesk`, then always returns phone
and email. It ignores `clients.contact`. Defaults give contact permission to the
front desk, so the gap appears when the admin removes that permission or gives
diary visibility to another role. The offline route probe returned synthetic
contact fields to a viewer with diary access and no contact permission.

Fix: require the client-search permission and redact contact fields without
`clients.contact`, or deny this contact-dependent search. Cover custom roles in
route tests; UI hiding alone cannot enforce this rule.

## S6: workflow destinations can address internal services

Booking app: `src/features/workflows/workflows.schemas.ts:25-31` and
`src/features/workflows/senders.ts:86-97`.
Workflow managers may configure plain HTTP to loopback, even in production, or
HTTPS to any hostname including private addresses. The sender makes a server-side
POST to that destination. Redirects are blocked, which is useful, but destination
resolution is not checked. The offline schema probe accepted a synthetic
`http://127.0.0.1:3000/internal` URL. No internal server request was made.

This creates an SSRF surface for users with `workflows.manage`, including managers
by default. It does not establish that an internal endpoint is exploitable or
that cloud credentials can be retrieved. External webhook delivery itself is an
intended feature and carries client contact data and booking management links.

Fix: use an approved destination allowlist, or validate resolved addresses and
block loopback/private/link-local IPv4 and IPv6 at connection time. Restrict
development exceptions to development. Apply network egress rules too; avoid
DNS-rebinding gaps. Review who may send booking data to external webhooks.

## S7: missing browser protections on booking app

Live `HEAD https://book.mindlap.in/login` returned no CSP, X-Frame-Options,
X-Content-Type-Options, Referrer-Policy or HSTS on the sampled response. The
checked-in Caddyfile only configures compression and reverse proxying, and
`next.config.ts` adds no security headers. TLS works and the login page uses
`private, no-store` caching. No framing or script-injection exploit was attempted.

Fix: add a tested security-header baseline at Caddy or Next, including
`nosniff`, referrer policy and HSTS. Use framing rules that preserve any intended
public booking embeds while refusing framing of staff/clinical pages. Build a
script CSP compatible with Next rather than adding a policy that breaks login.
The website has HSTS, nosniff, DENY and `frame-ancestors 'none'` live, but no script
CSP. Consider a compatible CSP there too because login tokens use localStorage.

## Other hardening and operational work

- Website publishing currently copies every tracked file under `assets/`. No PDF
  is currently tracked there, but accidentally staging a personal PDF would make
  it publishable. Add an enforced exclusion/build failure for personal documents,
  not only an agent instruction. Never stage the existing personal PDFs.
- Staff sessions last up to 12 hours. Roles and active status are rechecked, but
  password reset does not invalidate existing JWTs. Add per-account session
  revocation for incident response; review MFA for staff, especially admins.
- Worker OTP rate limiting fails open if its Durable Object is unavailable.
  Meta OTP verification also has an attempt cap, which reduces risk; the legacy
  Zoho fallback's implementation was not available for review. Verify that the
  fallback enforces equivalent limits before retiring the old system.
- Public/API/password limits are partly in process memory and reset on restart.
  Use shared counters before horizontal scaling or if abuse becomes material.
- Management links are persistent bearer credentials; verify expiry/revocation
  policy, protect logs and exports, and retain the existing no-referrer policy.
- Retire unused Catalyst origins from allowed server-action origins and remove
  old infrastructure and credentials after migration. Confirm AWS setup-key
  removal, least-privilege IAM, MFA, restricted SSH and database network access.
- Confirm database/storage encryption, TLS to the live database, backup retention,
  a tested restore, patching, log retention/redaction, monitoring and incident
  response ownership. Source configuration alone cannot establish these facts.
- Add a documented AWS recovery runbook and the planned US$35 budget alert.

## Checks and positive controls

- Six offline probes passed, confirming S1-S6 behaviours. Run from website repo:
  `node tools/security/review-checks.cjs C:\Users\Lenovo\Desktop\waky-boookingapp`.
  These execute actual actions/guards with mocked storage and synthetic identities;
  they demonstrate code paths, not authenticated end-to-end exploitability.
- Live private endpoint samples: client search returned 401, keyed credits API
  returned 401 and internal jobs returned 403 without authentication. Worker HEAD
  on `/api/services` returned 404, so this did not verify its GET catalogue route.
- `npm audit --omit=dev --json`: no known production dependency advisories.
  Full audit: four moderate affected packages in one nested esbuild dependency
  chain through drizzle-kit, advisory `GHSA-67mh-4wv8-2f99`. No high or critical
  advisories reported. Do not apply the suggested major downgrade blindly;
  assess an upstream fix and avoid exposing development servers.
- Worker deployment CLI has no checked-in lockfile, so no locked Worker build-tool
  dependency audit was completed. Its package declares Wrangler 3 while agent
  instructions deploy using Wrangler 4; align and pin the build tooling.
- Limited current-tree secret-pattern scan: 65 website and 432 booking-app text
  files (under 2 MB each). No private-key, AWS access-key or GitHub-token matches.
  Six database URL candidates in booking app were examples, local development
  defaults or tests. This scan does not cover all secret formats, Git history,
  ignored/untracked files, binaries or remote settings and cannot prove no leak.
- Staff deactivation and role changes are checked against the database each request;
  local shared-password login is disabled in production. Staff passwords use salted
  scrypt, reset tokens are hashed and consumed atomically, and calendar credentials
  have application encryption. API keys have scope checks and hashed storage.
- Payment and WhatsApp webhooks validate signatures. SQL access primarily uses
  parameterised Drizzle queries. Deployment runs the app as an unprivileged user;
  the production app port is not published directly by the checked-in compose file.

Next work: remediate S1-S3 with targeted tests, then S4-S7 and the operational
verification. Keep both projects' work logs current as each finding is closed.
