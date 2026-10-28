# Mindlap website: notes for every AI agent

This file is read by **Codex** (AGENTS.md) and by **Claude Code** (CLAUDE.md imports it). Both work on this
project for the same owner, Aflah. Keep it true: when something here changes, update it in the same commit.

## Working together (Codex and Claude Code)

- **Before you start:** `git pull`, then read the newest entries in `docs/WORKLOG.md`. The other agent may have
  changed things since you last looked.
- **When you finish a piece of work:** commit it, and add a short entry at the top of `docs/WORKLOG.md`:
  date, which agent, what changed, what is live, what is still open. Write it for the other agent, not for
  yourself: it has none of your chat history.
- **One agent per task at a time.** If the log says the other agent is mid-way through something, don't touch
  those files; work on something else or ask Aflah.
- **Never leave uncommitted changes** when you stop. Uncommitted work is invisible to the other agent and gets
  overwritten.
- Secrets (API keys, SSH keys, passwords, database URLs) never go in this repo, this file or the log. They
  live on Aflah's machine and in Cloudflare/AWS settings.

## What this repo is

- Shared ecosystem context and outstanding work: `docs/OVERVIEW.md`. Check the work log for newer updates.

- `mindlap.in`: a static site on **Cloudflare Pages**. Pushing to `main` publishes it (GitHub Action runs
  `tools/site/build_dist.py`, which copies only public files to `dist/`).
- `worker/`: the Cloudflare Worker `mindlap-booking-api` (`https://mindlap-booking-api.nasheel.workers.dev`).
  It connects the booking pages to **Waky**, the booking app at `https://book.mindlap.in` (separate repo
  `github.com/Aflah610/booking-app`). Deploy it with `npx wrangler@4 deploy` from `worker/`.
- `book/`: the booking flow pages (`book.js`, `book.css`). Plans and packages come from Waky.

## Rules

- **Generated pages:** service pages, the Kerala page, 404 and psychologist profiles are generated. Edit
  `tools/pages/content.py` or `tools/pages/therapists.json`, then run `python tools/pages/build.py` and
  `python tools/pages/profiles.py`. Don't hand-edit those HTML files.
- **Cache versions:** after changing `index.css`, `index.js`, `pages.css` or `book/*`, bump the `?v=` number
  on every page that loads it (generated pages take it from `tools/pages/build.py`). These files are cached
  for a year, so after pushing check the live file has the new code
  (`curl -s https://mindlap.in/index.js?v=N | grep <something new>`). If not, bump the number again.
- Link with clean URLs (`/rashin`, `/privacy`), never `.html`.
- **Account / Log out:** the profile badge appears only on the home page; signed-out visitors see Log In there.
  Booking steps and the account page show Back to site without an account badge. Log out stays only inside the
  home-page profile badge menu, including on mobile.
- **View bookings:** `/account/` shows prepaid balances and paid/prepaid-confirmed upcoming sessions and history.
  Failed or pending payment attempts belong to recovery, never account eligibility or session counts. Match the
  light booking-journey UI with neutral cards and restrained violet accents.
- **Booking navigation:** all booking buttons use `/book/`, retaining `?therapist=Name` when a therapist is chosen.
  No WhatsApp navigation links anywhere, including self-check results, service/profile pages and floating/mobile
  shortcuts. WhatsApp remains the delivery channel for OTPs and reminders; support can use email or phone.
- Brand colour is violet (`--primary-color #4A2E80`, `--accent-color #8E66DE`).
- Copy is in plain English (British spelling) and without long dashes.
- Never put the WhatsApp number or other contact details in a URL query except the existing `wa.me` links.

## People and accounts

- Owner: Aflah (GitHub `Aflah610`). Admin email `nasheel@mindlaptherapy.com`.
- Psychologists on the site: Rashin, Theresa, Christine, Jasmin, Fathima, Ansha.
