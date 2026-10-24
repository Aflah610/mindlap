# Mindlap system overview

Last updated: 25 October 2026. This is the shared big picture for both projects.
Read `AGENTS.md` and the newest entries in `docs/WORKLOG.md` before starting work;
the work logs record changes after this snapshot.

## Aim

One Mindlap system for the website, booking, payments, client files and case
history, leads, follow-ups and reports, under Aflah's control. Zoho stays only for
Mail, Books and the admin account. MCH, Zoho CRM, Zoho Bookings, Catalyst and Neon
are to be retired after their remaining dependencies are resolved.

## Ecosystem

```text
Client's phone or laptop
  |
mindlap.in: website on Cloudflare Pages
  Pages, self-check and /book
  |
mindlap-booking-api: Cloudflare Worker
  OTP, Razorpay payments and communication with the booking app
  |
book.mindlap.in: Waky booking app
  AWS Lightsail Mumbai and Postgres
  Psychologists, hours, slots, bookings, packages and credits
  Clients, case history and session notes
  Leads, online/offline allocation and follow-ups desk
  Roles: admin, manager, psychologist, BDE and CCD
```

- Website repository: `mindlap-therapy`.
- Booking app folder: `waky-boookingapp`; GitHub repository: `Aflah610/booking-app`.
- Pushing website `main` publishes through GitHub Actions and Cloudflare Pages,
  normally within a minute. `tools/site/build_dist.py` copies only public files.
- Booking app `main` deploys automatically in about five minutes, only after CI
  passes lint, typecheck, tests and build.
- Zoho Mail and Books stay. MCH holds old clinical records until migration.
  Zoho CRM continues receiving leads until the replacement is ready.

## Completed

- Booking app server and database moved to AWS Mumbai; live at `book.mindlap.in`.
- Website booking connects to the new app through the Worker.
- Plan page offers individual and couple packages of 4, 8 and 12 sessions.
- Home page design fixes, self-check animations and encouragement messages.
- Five roles with permissions editable by the admin. Only CCD books for clients.
  Psychologists see their own clients without contact details. Managers see only
  pending case notes under the 24-hour rule.
- Leads split 50/50 between BDEs, with an online/offline switch.
- Follow-ups desk has a thread per client between the psychologist and CCD.
  Reassigning the client moves the open thread to the new psychologist.
- Clients directory, MCH's six-step case history and MCH session note fields.
  Reassignment preserves the full clinical history.
- Booking hours 9 AM to 11 PM, a 30-minute gap after each session and a maximum
  of seven sessions per psychologist per day. Individual therapy lasts 60 minutes;
  couple therapy lasts 90 minutes.
- Shared agent instructions and work logs exist in both repositories.

## Pending, in priority order

1. **MCH migration, next:** importer is ready at `scripts/import-mch.ts` in the
   booking app, with export SQL at `deploy/mch/export.sql`. Export, practise with a
   dry run, show Aflah the counts, then perform the real copy after approval.
   Expected source counts: 303 clients, 207 case histories, 411 session notes and
   13 psychologists. Match by phone and staff name. Never print or log clinical
   text. Shut MCH down only after the migration is checked.
2. **Zoho CRM shutdown:** move the eight clients with remaining credits, decide
   what to archive, then route new leads (around 23 a day) into the booking app.
3. **WhatsApp:** own-number OTP is built but disabled pending Meta billing and a
   permanent token. Ad leads also need Coexistence on the number ending 00774.
4. **Callyzer:** call tracking is on hold pending answers from the provider.
5. **Infrastructure clean-up:** delete the Catalyst app and Neon project when no
   longer needed, disable the AWS setup key and add a US$35 AWS budget alert.
6. **Owner decisions and existing local work:**
   - Should upcoming bookings move when a client changes psychologist? They
     currently stay with the old psychologist.
   - Should the website's remaining green accents become violet?
   - Review the existing uncommitted `account/index.html` change with Aflah before
     touching it.
   - Never commit or publish the personal PDFs in the website's `assets/` folder.
7. **Later:** live reports dashboard to replace Sheets, and further CCD role details.

## Starting and handing over work

Open `mindlap-therapy` for website work or `waky-boookingapp` for booking app work.
Keep each request focused on one task, name the project and describe what should
be visible when it is complete. Screenshots help with design work.

```text
Read AGENTS.md and the top of docs/WORKLOG.md first, and git pull.

Task: <one task in one or two lines>
Example: <reference or screenshot, if useful>
Done when: <observable result, including whether it must be live>

When finished: commit, push, and add a WORKLOG entry.
```

When switching agents mid-task, identify the unfinished task and check its work
log. One agent works on a task at a time. Password entry, billing approvals and
any action requiring the owner's intervention remain with Aflah. Keep secrets
out of both repositories and their documentation.
