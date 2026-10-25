# Work log (shared by Codex and Claude Code)

Newest first. One entry per finished piece of work: date, agent, what changed, what is live, what is open.
This repo is the website; booking app work is logged in the booking-app repo's `docs/WORKLOG.md`.

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
