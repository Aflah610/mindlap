# Work log (shared by Codex and Claude Code)

Newest first. One entry per finished piece of work: date, agent, what changed, what is live, what is open.
This repo is the website; booking app work is logged in the booking-app repo's `docs/WORKLOG.md`.

## 2026-10-27 · Claude Code · MCH closed to everyone (reversible)

- mchoperationmanager.site now sends no page at all (nginx 444: browser shows a bare connection error), on http and https.
- On the MCH EC2 server: `~/mch-off.sh` closes it, `~/mch-on.sh` reopens it exactly as before (tested both ways).
  The containers are stopped (no auto-restart); the database and media volumes are untouched.
- Backup taken first: `~/mch-backup-2026-10-27/` (database dump + media) on the same server.
- Open: the EC2 instance itself still runs and costs money; stopping or deleting it is Aflah's call.

## 2026-10-27 · Claude Code · profile badge with Log out on the booking pages

- book/book.js `renderProfileBadge`: when logged in, the booking pages' top bar (/book/* and /account/) shows the same
  profile badge as the home page; Log out (and View bookings) live in its menu only. Log out clears the login and
  the saved draft, then goes home. book.js?v=37 on all nine pages.
- account/index.html: its long-uncommitted change was only the book.css/book.js version bumps; committed with v=37.
- Booking app (book.mindlap.in) phone layout: Sign out badge is hidden on small screens; being fixed in booking-app.

## 2026-10-26 - Codex - OTP integration published; current provider retained

- Aflah approved deployment and setup. Published tested integration 77a13e7 to main; backend 94bc080 is on its
  production main with check, Docker and publish green. Backend public health is ok.
- Created the dedicated OTP-only booking-app key and uploaded BOOKING_OTP_API_KEY to this Cloudflare Worker.
  Temporary plaintext key file removed; no credentials in Git or output. SESSION_TOKEN_SECRET unchanged.
- Worker OTP_PROVIDER remains meta: no cutover or live OTP test yet. Server Meta configuration is pending SSH
  access (two timeouts). Aflah asked Codex to handle the current-IP SSH rule; saved AWS booking session reports
  Mumbai restricted and needs the correct account/session. No firewall or Creator changes made.
- Resume by configuring the four server OTP_META/template variables, checking backend deployment/migration,
  deploying OTP_PROVIDER=booking, and validating one authorised send plus user verification and admin report.
  Preserve Creator history and CCD account. Prior automatic approval block was superseded by explicit approval.

## 2026-10-26 - Codex - Cloudflare booking-app OTP connection prepared

- Inspected Creator functions: effective five-minute expiry, six-digit codes, Meta English Authentication template
  with matching body/Copy Code button. Recorded parity in booking-app docs/otp-migration.md; no Creator changes.
- Added opt-in OTP_PROVIDER=booking routing before catalogue loading. Booking app owns codes and Meta delivery;
  Cloudflare retains website sessions, phone/IP limits and the current phone/reference association only.
- Limits and reference storage fail closed. No Creator fallback on the booking provider, no session on upstream
  errors or phone/reference mismatch. Out-of-order resend replies cannot overwrite a newer reference.
- Thirteen synthetic Worker/payment regression checks pass, including real session HMAC/24-hour lifetime and
  replay refusal. Added Node 22 CI workflow. Live routing still meta; no OTP key/server settings or cutover yet.
- Booking-app PR #6 passed 497 tests / 46 files and all build checks; Worker PR mindlap#5 passed its CI.
  Both remain drafts. Automatic review blocked backend main publication pending specific live-deployment approval.
- Awaiting Aflah approval for production cutover, OTP-only key creation and previously blocked SSH-key use for
  server Meta settings. No production OTP provider, credential or Creator setting changed. Do not bypass the block.

## 2026-10-26 · Codex · unpaid attempts removed from registered Clients

- Aflah reported four unpaid website contacts showing in booking-app Clients. Corrected the directory and CSV
  registration filter; empty case-history records do not qualify. Paid/free and manual/imported/existing-care
  registrations remain visible. No contact, payment or booking records deleted.
- Live Clients refreshed: No clients yet / Showing 0 clients. Verified all five Payment failed attempts remain in
  Bookings. PR #5, code 2e98bc3, final handover 8a2bc0f; main CI passed 492 tests / 45 files and all build checks.
- Website functional files and existing personal/local edits untouched. Booking-app AGENTS.md records the rule.

## 2026-10-26 · Codex · S3-S7 complete and live

- S3 Worker payment-capture fix deployed and verified; six synthetic regression tests pass, catalogue GET 200.
- Booking-app S4/S5 permission fixes, S6 public-only HTTPS webhook delivery with DNS pinning, and S7 nonce CSP /
  security headers are on main and live (code fbd368f; final handover cfd5122). Preserved Claude's case-list change.
- Final main validation passed 490 tests across 45 files, lint, typecheck, production build, Docker and production
  dependency audit. Corrected two clinical regression fixtures that briefly blocked main CI; both are resolved.
- Live login has matching fresh nonces on all ten scripts plus nosniff, no-referrer, HSTS and framing DENY.
  /book retains Mindlap website embedding; health ok, unauthenticated client search 401, Worker catalogue 200.
- Updated security review with remediation evidence and remaining operational scope. No production client records,
  real payments or customer messages used. No server login/key used. CCD Coexistence still awaits Meta's specialist;
  do not delete/re-register the existing WhatsApp account. Existing account-page edit and personal files untouched.

## 2026-10-26 · Codex · S3 deployed and synthetic regression suite saved

- Deployed Claude's captured-payment-only Worker fix using Wrangler 4.152.0 after Aflah authorised deployment.
  Live Worker version d9d18226-56c0-44d7-8a6c-e50e9f682407. Public GET /api/services returned HTTP 200 JSON.
- Added tools/security/payment-capture.test.mjs: failed capture never confirms bookings or credits, failed state
  refetch stays pending, concurrent capture is recovered, captured callbacks succeed, and webhook failures return 503.
  All six tests passed using synthetic data and mocked network calls. No real payment was initiated or changed.
- S1/S2 remain in booking-app main; S4-S7 remediation in progress there. Existing account-page edit and personal
  files left untouched. Meta Coexistence case still awaits a non-destructive resolution; do not delete CCD account.

## 2026-10-25 · Claude Code · S3 payment fix committed, worker NOT deployed yet

- worker/src/waky.js: a Razorpay payment counts as paid only once captured; a failed capture is re-checked with
  Razorpay, otherwise stays pending (browser retries) and the webhook answers 503 so Razorpay resends. Offline checks
  5/5 (capture fail, Razorpay down, already captured, success, package order).
- NOT live: `npx wrangler@4 deploy` (from worker/) was blocked by the agent's safety check; Aflah must run it.
- Booking-app S1/S2 fixes are on main (c2a69b6, CI passed); see booking-app docs/WORKLOG.md.

## 2026-10-25 · Codex · continued Claude's CCD WhatsApp work

- Latest Claude work was in booking-app, beyond this website log: Meta app live, Google sign-in/Meet setup,
  staff changes, and MCH dry run completed. Its docs/WORKLOG.md is the current detailed source.
- Took over the interrupted ccd-number branch (waky-mch worktree). CCD WhatsApp settings/routing now live at
  book.mindlap.in/admin/settings/whatsapp, code c48457f; verified separate enabled sales and CCD connect buttons.
  CCD/OTP replies stay out of sales leads. Both numbers remain unconnected; no live messages or workflows enabled.
- PR #1 merged; CI passed 446 tests, lint, typecheck, production build, Docker and production dependency audit.
- Next: Aflah connects the CCD phone, Meta billing, permanent sending token, approved templates and an opted-in test.
  Activation handover/template drafts: booking-app docs/whatsapp-ccd-handover.md. Zoho 774 cutover, Calendar connections,
  security findings and MCH real import remain open; MCH import still needs approval after security fixes.
- Website code unchanged. Existing account-page edit and personal PDFs left untouched.

## 2026-10-25 · Codex · cross-project security review

- Added `docs/SECURITY-REVIEW-2026-10-25.md` in both projects: three high-priority
  findings (admin identity edits, booking mutation permissions, payment capture)
  and four medium-priority findings. All remain open; no live fixes deployed.
- Added offline synthetic probes in `tools/security/review-checks.cjs`; six code
  paths confirmed without client data, real payments or production writes.
- Live sampled private routes refused unauthenticated access; production npm audit
  has no known advisories. AWS account/network/backups and legacy systems were
  not independently verified. Read the report before expanding access/importing data.
- Existing account-page edit and local assets untouched. Personal PDFs not staged.

## 2026-10-25 · Codex · shared system overview

- Added `docs/OVERVIEW.md` with Aflah's ecosystem summary, completed work, pending
  migrations, owner decisions and handover guidance; linked it from `AGENTS.md`.
- Same overview added to the booking app. Documentation only; live behaviour unchanged.
- Open: MCH dry run and count review remain next. Existing account-page change
  and local assets were left untouched; personal PDFs must never be published.

## 2026-10-25 · Claude Code · state at handover

Live on mindlap.in:
- Home: self-check answers animate on tap (pop, fade others, next question slides in); encouragement after
  questions 3 and 7. `index.js?v=39.3`, `index.css?v=163`.
- Home: "Your feelings are valid" footnote removed; closing banner violet, no line before its label; no
  dashes in hero line and result texts.
- Plan page: one session on top, Packages panel (4, 8, 12 sessions). Couple therapy packages added in Waky
  (₹5,400 / ₹10,200 / ₹14,400; ₹1,500 a session).

Open:
- Other green accents on the site (menu underline, hover states, language badges) still green; Aflah may want
  them violet.
- `account/index.html` has an uncommitted change from an earlier session; check with Aflah before touching it.
- Untracked files in `assets/` (`Adhar PAN.pdf`, `primary file .pdf`, `ansha.jpeg`, `fathima.jpeg`,
  `jasmin.jpeg`): personal documents among them. Never commit or publish the PDFs.
