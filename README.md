# Mindlap Therapy - mindlap.in

Static website (GitHub Pages) plus a Cloudflare Worker backend that connects
the online booking flow to Zoho Bookings, Zoho Creator, Zoho CRM, WhatsApp
(Meta) and Razorpay.

## Project structure

```
mindlap-therapy/
├── index.html            Home page (includes the Book Online modal / wizard)
├── index.css             Styles for every page
├── index.js              Site-wide script (nav, animations, therapist data)
├── booking.js            Book Online wizard: OTP -> credits/type -> details -> payment
│
├── anasooya.html  athira.html  gouri.html      Therapist profile pages
├── rashin.html    sajitha.html theresa.html
├── privacy.html   terms.html                   Legal pages
│
├── assets/               Images, icons, favicons (only files the site uses)
├── dev/                  Internal test pages, not linked, blocked in robots.txt
│   ├── sessions-test.html   "My Sessions" prototype (OTP -> past/upcoming)
│   └── sessions-test.js
│
├── worker/               Cloudflare Worker (the backend / API)
│   ├── src/index.js      All API routes
│   ├── wrangler.toml     Non-secret config (secrets are listed in comments)
│   └── package.json
│
├── docs/
│   └── zoho-bookings-setup.md   Original Zoho Bookings + Worker setup guide
│
├── CNAME  robots.txt  sitemap.xml  manifest.json  favicon.ico
└── README.md
```

## How the pieces connect

```
Browser (mindlap.in)
   │  booking.js
   ▼
Cloudflare Worker  (mindlap-booking-api.nasheel.workers.dev)
   ├── Zoho Creator  Send_OTP / Verify_OTP custom APIs  ──►  Meta WhatsApp (OTP message)
   ├── Zoho Creator  customers, appointments, sync-error log (database of record)
   ├── Zoho Bookings calendar slots + the real appointment
   ├── Zoho CRM      prepaid package credits (Contacts.Package_credit_value)
   └── Razorpay      payments (code ready, waiting on account verification)
```

### OTP / verification flow

1. Customer picks a country code (India default) and enters their number.
2. `POST /api/otp/send` - the Worker validates the number (E.164; India = 10
   digits) and calls Zoho `Send_OTP`, which saves a 6-digit code (5-minute
   expiry, max 5 tries, 60 s resend cooldown, max 5 codes / 30 min) and sends
   it on WhatsApp. If only WhatsApp delivery fails, the response has
   `delivery_failed: true` and the code box is still shown.
3. `POST /api/otp/verify` - the Worker calls Zoho `Verify_OTP`. On success it
   returns a signed `session_token` (HMAC-SHA256, valid 24 h, kept only in
   page memory).
4. Every later call that touches a customer's data (`/api/book`,
   `/api/credits/*`, `/api/sessions`) requires that token and takes the phone
   number from it, never from the request body.

## Deploying

- **Website:** push to `main`; GitHub Pages publishes it in ~1 minute.
  Bump the `?v=` number on `index.css` / `booking.js` / `index.js` in the HTML
  whenever you change those files, or browsers keep the old copy.
- **Worker:** `cd worker && npx wrangler deploy` (separate from the website).
  Secrets are set with `npx wrangler secret put NAME`; the list is in
  `worker/wrangler.toml`.
- Watch live Worker logs with `cd worker && npx wrangler tail`.
