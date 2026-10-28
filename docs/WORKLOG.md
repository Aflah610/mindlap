# Work log (shared by Codex and Claude Code)

Newest first. One entry per finished piece of work: date, agent, what changed, what is live, what is open.
This repo is the website; booking app work is logged in the booking-app repo's `docs/WORKLOG.md`.

## 2026-10-28 - Codex - Collapse date picker after choosing a day

- Aflah clarified that after selection only the chosen day should remain and times should sit higher. Schedule
  now replaces the date heading/chip strip with a compact Selected date row and Change date button. Tightened
  spacing above it, including the resume notice. The 30-day picker reopens on Change date and receives focus.
- While choosing another date, times hide and Continue disables. Choosing a day collapses the picker, resets
  time scrolling and shows live availability; a changed date still clears the previous time and releases stale
  holds. Reopening invalidates old availability responses. Same-day selections can retain an existing hold.
  Saved-date restore and next-day recovery also use the collapsed selected row. No backend/pricing changes.
- Synthetic browser checked initial picker, selected Thursday row only, Change date reopening with times hidden
  and Continue disabled, successful hold, different-day reset, empty Friday and next-day recovery to Saturday.
  Resume notice included; 390x736 and 320x568 fit without page overflow, Continue visible. Screenshot saved and
  viewport reset. No live hold/booking/payment/message or client write.
- JS syntax, public build, diff and all 13 payment/OTP regressions pass. Preview server/script removed, dist
  rebuilt with production API and no fixture code. CSS v22 / JS v45 on all nine loading pages.
- Publishing; live verification follows. Previously deferred booking logic issues remain open.

## 2026-10-28 - Codex - Review, consent and Agree & Pay design

- Recreated Aflah's checkout reference with Almost there heading; therapist photo/name/role from existing
  public profile metadata, editable session/package, online mode, date and duration-derived time range (IST),
  bill summary, package saving when the same therapist's current single price supports it, consent card and
  bottom Back / Agree & Pay controls. Real service price, currency and package session count retained.
- Your details/notes and existing payment information remain available in expandable sections. Existing hold
  countdown stays visible. Header/account badge retained. Core review/consent visible at 390x844; smaller
  screens can scroll the review region while payment stays visible (320x568 checked, no page overflow).
- Existing Terms & Conditions, Privacy Policy and online-therapy consent retained; no invented refund policy,
  offline location or coupon capability. Consent stays unchecked by default and focuses if payment attempted
  without it. Prepaid/free bookings still show Confirm booking with zero total; paid bookings use Agree & Pay.
- Existing order/verify/abandon, prepaid/free endpoints, hold/idempotency and Razorpay processing unchanged.
  Synthetic checks: required consent, controlled create-order error and enabled retry, details expansion,
  accurate package saving, single-session no false discount, prepaid balance/zero total and free zero total.
  No live payment/order/booking or message created. Preview removed real Razorpay SDK and used a local API
  that rejects payment/booking attempts. Deleted preview script/server and rebuilt dist with real SDK/API back.
- JS syntax, unique HTML IDs, public build, diff and all 13 existing payment/OTP regressions pass. Screenshot
  saved; viewport reset. CSS v21 / JS v44 on all nine loading pages. Deployment 1df87d4 passed; live checkout
  markup, JS v44 and CSS v21 verified, with no fixture code.
  Previously deferred booking logic issues remain open.

## 2026-10-28 - Codex - Date-first schedule screen from Aflah's reference

- Schedule now uses the light single-column layout: therapist/service summary with Change, five visible date
  chips with the remaining 30-day range horizontally accessible, selected month/year, grouped Morning/Afternoon/
  Evening buttons, IST label and a Continue bar below the time list. Smaller screens scroll only the time area.
- Fresh visits do not auto-select today or fetch/show availability until the user chooses a date. Valid saved
  dates still restore with times visible. Changing dates clears the previous time and retains existing hold
  release, request ordering, real availability, prepaid and paid rebooking behaviour. Real prices stay dynamic;
  packages show their total for N sessions rather than incorrectly labelling the total as per-session.
- Date radios support arrows/Home/End with roving focus. Time buttons expose selected state. A slot conflict
  message now survives refreshing availability instead of being immediately cleared. Continue remains disabled
  until a server-confirmed hold; successful selection carries the chosen time to Details.
- Synthetic local checks: initially hidden times, date selection, grouped slots, no-open-times/next-day recovery,
  successful hold, date change clears selection, conflict leaves Continue disabled with visible error, keyboard
  date selection, saved-date restore, prepaid and paid-rebooking labels, Details handoff. 390x844 and 320x568
  fit with Continue visible; compact prepaid also fits 320x568. Screenshot saved and viewport override restored.
- JS syntax, unique HTML IDs, public build, diff checks and all 13 existing payment/OTP regressions pass.
  No live hold, booking, payment, OTP or client write. Removed preview script/server and rebuilt dist, checking
  production API retained and no fixture code. CSS v20 and JS v43 bumped on all nine loading pages.
- Deployment 59d7747 passed; live schedule markup, JS v43 date-first logic and CSS v20 verified with no
  fixture code. Previously deferred booking logic issues remain open.

## 2026-10-28 - Codex - Redesigned booking screens fit one mobile viewport

- Aflah reported scrolling and a hidden final package on his phone. Removed oversized fixed bottom spacing
  across number entry, code entry and session choice; spacing and illustration size now follow usable dynamic
  viewport height. Compact sizing for short screens preserves every control rather than clipping overflow.
- Plan footer now participates in the layout and stays at the bottom using available free space; it cannot
  cover packages. Cards, gaps, icons and headings compact on short screens. Back shares the heading row on
  short screens. Header remains usable with the logged-in account badge. No price, booking or OTP logic changes.
- Mobile country dropdown stays within the screen with only its long result list scrolling internally.
  Number input is 16px on mobile to avoid automatic browser zoom. No overflow suppression applied to the page;
  enlarged accessibility text and unusually short/keyboard-covered screens can still scroll to reach controls.
- Synthetic local browser checks: 320x568, 360x640 and 393x736 plan layouts, all four package choices visible
  above Continue, selected 12-session footer and prepaid mode fit; number, OTP code and session-choice screens
  at 320x568 all had document height equal to viewport height and no horizontal overflow. Country popup stays
  within viewport. No live OTP, booking, payment or client write. Screenshot saved; viewport override restored.
- CSS-only change. All nine loading pages use CSS v19 (final readable card-height adjustment). Build and diff
  checks pass; removed preview server/script
  and rebuilt dist, verifying production API and no fixture code. Deployment 52329e4 passed; live plan HTML
  loads CSS v19 and the final height-aware sizing rules are verified on the live asset.
  Deferred booking logic issues remain open.

## 2026-10-28 - Codex - Plan selection redesigned from Aflah's reference

- Choose a plan now uses a light single-column layout, single-session card, grouped Packages with coloured
  stack icons, per-session prices, calculated undiscounted totals struck through only when a saving exists,
  selection circles and a fixed Continue bar. Therapist/type context and Back/Change therapist stay available.
- Service IDs, actual prices, currencies, available packages and prepaid behaviour still come from the existing
  booking catalogue. No service prices, payment processing, provider or backend changed. Existing selection
  restores; Continue stays disabled until selection. Added arrow/Home/End radio keyboard selection and focus.
- Synthetic local checks covered individual, couple, prepaid, selecting a package and handing its correct price
  to scheduling, keyboard selection and disabled initial Continue. Mobile 390/320 px and desktop no horizontal
  overflow. Screenshot saved. No OTP, payment, booking or live client record created during testing.
- JS syntax, unique HTML IDs, public build, diff check and all 13 existing payment/OTP regressions pass.
  Removed local preview script and rebuilt dist; confirmed production API and no fixture code. Temporary
  browser viewport restored. CSS v17 / JS v42 on all nine loading pages. Deployment f069e09 passed; live
  plan markup, CSS layout and JS icons verified, with production API retained and no fixture code.
  Previously deferred booking logic issues remain open.

## 2026-10-28 - Codex - Searchable country picker for OTP number entry

- Replaced the 18-country native select with a searchable dropdown matching Aflah's reference: flags,
  country names, right-aligned calling codes and a scrollable alphabetical list. Uses the booking app's
  existing 243-country/territory ISO and calling-code dataset; shared codes retain the selected country's
  identity. India remains default. Search supports names, ISO, calling codes and UAE/UK/USA aliases.
- Flags are local flag-icons SVGs with MIT licence retained in assets/flags; no third-party flag requests.
  Keyboard arrows, Enter selection, Escape, outside click and focus dismissal supported. Empty results explain
  how to retry. Existing phone normalisation, OTP sending/verification and provider remain unchanged.
- Local browser checked flags, alphabetical list, +971 search/selection, Canada sharing +1, keyboard Enter,
  Escape, no-results state and 390/320 px layouts without horizontal overflow. No OTP sent or booking created.
  JS syntax and all 13 Worker regressions pass. CSS v16 and JS v41 bumped on all nine loading pages.
- Deployment 18f8679 passed. Live HTML, JS v41, CSS v16 and mobile dropdown verified; visible flags loaded,
  no horizontal overflow. Screenshot saved; temporary viewport reset. Nine booking logic issues stay deferred.

## 2026-10-28 - Codex - Six-box OTP entry and individual/couple cards from new references

- Aflah supplied separate reference images for the code step and session choice. OTP code step now has a green
  WhatsApp delivery banner, Verify your code title, formatted actual destination and inline Change, six digit
  boxes, Resend in Ns timer and a disabled-until-complete verify button. Existing auto-verification on six digits
  remains. One labelled one-time-code input drives the boxes, preserving keyboard editing, paste and autofill.
- Delivery failure never displays the success banner. Change restores number entry and its original heading;
  resend cooldown, errors, phone/provider/session/account/therapist routing stay in place. No backend changes.
- Session choice is a light single-column page with Back, the requested heading, person/couple icon cards and
  chevrons, and matching violet waves. Therapist context and plan routing retained. Unavailable choices still
  disable with an explanatory message. Other booking page layouts not restyled.
- Local fake-endpoint checks: non-digit cleaning, incomplete/complete code button states, invalid-code retry,
  failed delivery without false success, Change and resend; both cards navigated to the correct synthetic plan.
  Mobile 390/320 px no horizontal overflow. Preview uses synthetic data only; no WhatsApp/session/booking created.
- All 13 existing Worker regressions, JS syntax, HTML unique IDs, public build and diff checks pass. Removed fake
  server/script and test-only endpoint/session fixture, rebuilt dist and verified production API unchanged.
  Temporary viewport reset. book.css v15 and book.js v40 bumped on every loading page.
- Deployment 97b896c passed. Live OTP markup, session cards, CSS v15 and JS v40 verified, including the original
  production API and absence of test fixtures. Nine booking logic issues remain deferred.

## 2026-10-28 - Codex - OTP screen redesigned from Aflah's reference

- Replaced /book/ verification's sidebar/card layout with the supplied single-column design: WhatsApp illustration,
  heading, compact flag/country selector and phone field, rounded slate button, back link and soft violet waves.
  Scoped CSS to verify-page so the remaining booking/account layouts retain their existing styles.
- Number-first entry: removed the name requirement from OTP send; name is still required at booking Details and
  now also updates the profile badge there. Existing OTP provider, phone validation, sessions, resend cooldown,
  verification errors and account/therapist routing retained. OTP migration remains paused; no backend changes.
- Checked desktop, 390px and 320px layouts (no horizontal overflow), India/UAE selector, invalid phone, code-entry,
  60-second resend cooldown, incorrect-code error and Change number using a loopback-only fake OTP endpoint.
  No live message, session or booking created. Fake endpoint and preview-only API replacement removed; final dist
  rebuilt and verified to use the real production endpoint. Temporary preview servers stopped; viewport reset.
- Node syntax, HTML IDs/DOM contract, public dist build and all 13 existing Worker/OTP/payment regressions pass.
  Cache references bumped everywhere: book.css v14, book.js v39. No personal untracked assets included.
- Main deployment 06b498a passed. Live HTML, book.css?v=14 and book.js?v=39 verified to contain the new UI and
  original production endpoint, with no mock route. Published page checked in Chrome. Nine booking logic bugs stay deferred.

## 2026-10-28 · Claude Code · Anasooya removed from mindlap.in

- Aflah: Anasooya no longer works with Mindlap. Removed from therapists.json (about page, profile "others" lists,
  build.py reviewer list), the home page card, the quiz matches (anxiety now Fathima, depression low Fathima,
  stress low Jasmin, loneliness Christine), book.js ONLINE_THERAPISTS, sitemap and helper scripts.
  anasooya.html deleted; /anasooya and /anasooya.html 301 to /#therapists (build_dist.py _redirects).
- index.js?v=40, book.js?v=38 everywhere. Her photos stay in assets/ unused.
- Booking app staff record is separate (book.mindlap.in): handled there.

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
