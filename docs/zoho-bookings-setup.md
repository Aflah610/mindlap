# Connecting Zoho Bookings via Cloudflare Workers

This site now has a "Book Online" flow (nav bar + the bottom "Your mental
health matters" section) that opens an in-page booking form. That form talks
to a small Cloudflare Worker at [`worker/`](../worker), which proxies the
[Zoho Bookings REST API](https://www.zoho.com/bookings/help/api/v1/). Zoho
credentials live only as Worker secrets and never reach the browser.

The WhatsApp "Book Session" buttons are untouched - this is an additional,
separate way to book.

```
Browser (mindlap.in)  --fetch-->  Cloudflare Worker  --OAuth-->  Zoho Bookings API
     booking.js             (worker/src/index.js)        accounts.zoho.<dc>
```

## 1. Set up Zoho Bookings itself

If you haven't already:

1. Sign in to [Zoho Bookings](https://bookings.zoho.com) (or `bookings.zoho.in`
   if your Zoho account is on the India data center).
2. Create a **Workspace** (Zoho's term for a booking page/business unit).
3. Under the workspace, create the **Services** clients can book (e.g.
   "Individual Therapy Session - 50 min").
4. Add each therapist as **Staff** and assign them to the relevant services.
5. Note which Zoho data center your account is on - look at the URL you log
   in with: `zoho.com` (US/global), `zoho.in` (India), `zoho.eu`, etc. You'll
   need this as `ZOHO_DC` below (just the suffix, e.g. `in`).

## 2. Create Zoho API credentials (Self Client)

The Worker authenticates as a "Self Client" - a server-to-server Zoho OAuth
app with no interactive login, ideal for a backend like this.

1. Go to the [Zoho API Console](https://api-console.zoho.com) for your data
   center (use `api-console.zoho.in` if you're on the India DC, etc.).
2. Click **Add Client** → **Self Client**.
3. Copy the **Client ID** and **Client Secret** shown - you'll need both.
4. Open the **Generate Code** tab on the same Self Client:
   - Scope: `ZohoBookings.data.ALL`
   - Time duration: 10 minutes (plenty - you use the code immediately)
   - Description: anything, e.g. "Mindlap website booking"
   - Click **Create** and copy the generated code (it's single-use and
     expires fast).
5. Exchange that code for a **refresh token** immediately, from a terminal:

   ```bash
   curl -X POST "https://accounts.zoho.in/oauth/v2/token" \
     -d "grant_type=authorization_code" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET" \
     -d "code=THE_CODE_FROM_STEP_4"
   ```

   (Swap `zoho.in` for your data center if different.) The JSON response
   includes a `refresh_token` - this is the long-lived credential the Worker
   will use forever (it doesn't expire unless you revoke it in Zoho).

Keep the Client ID, Client Secret and Refresh Token somewhere safe (a
password manager). You'll paste them into Wrangler as secrets in step 4 -
never commit them to the repo.

## 3. Find your Workspace ID

Once you have an access token (or just use the `access_token` from the
exchange above for a one-off test), call:

```bash
curl "https://www.zohoapis.in/bookings/v1/json/services?workspace_id=" \
  -H "Authorization: Zoho-oauthtoken YOUR_ACCESS_TOKEN"
```

If that doesn't return anything useful, the simplest path is: open Zoho
Bookings → Settings → Workspaces, click into your workspace, and the
`workspace_id` appears in the page URL (a long numeric ID). Save it for
`ZOHO_WORKSPACE_ID` below.

## 4. Deploy the Cloudflare Worker

You said you already have a Cloudflare account, so:

```bash
cd worker
npm install
npx wrangler login          # opens a browser to authorize Wrangler
```

Edit [`worker/wrangler.toml`](../worker/wrangler.toml):

- `ZOHO_DC` → your data center suffix (e.g. `in`)
- `ZOHO_WORKSPACE_ID` → the ID from step 3
- `ALLOWED_ORIGIN` → keep `https://mindlap.in,https://www.mindlap.in`
  (only these origins will be allowed to call the Worker)

Then set the three secrets (you'll be prompted to paste each value; nothing
is echoed to the terminal or written to any file):

```bash
npx wrangler secret put ZOHO_CLIENT_ID
npx wrangler secret put ZOHO_CLIENT_SECRET
npx wrangler secret put ZOHO_REFRESH_TOKEN
```

Deploy:

```bash
npx wrangler deploy
```

Wrangler prints a URL like:

```
https://mindlap-booking-api.<your-subdomain>.workers.dev
```

That's your live API. No DNS changes are needed - `workers.dev` works out of
the box. (If you'd rather serve it from `booking-api.mindlap.in`, that
requires moving mindlap.in's DNS to Cloudflare and adding a Worker route;
skip that for now unless you want it.)

## 5. Point the website at your Worker

Open [`booking.js`](../booking.js) and replace the placeholder at the top:

```js
const BOOKING_API_BASE = 'https://mindlap-booking-api.YOUR-SUBDOMAIN.workers.dev';
```

with the real URL Wrangler printed in step 4. Commit and deploy the site as
usual (GitHub Pages, based on the `CNAME` file in this repo).

## 6. Test it

1. Quick backend check:
   ```bash
   curl "https://mindlap-booking-api.<your-subdomain>.workers.dev/api/services"
   ```
   You should get back your Zoho services as JSON, not an error.
2. On the live site, click **Book Online** in the nav (desktop) or the
   **Book Online Instantly** button in the bottom CTA section. Choose a
   service, therapist, date, and a time slot, fill in your details, and
   submit. Confirm the booking appears in Zoho Bookings.

## Troubleshooting

- **"Worker is not configured yet"** - you deployed before setting
  `ZOHO_WORKSPACE_ID` in `wrangler.toml` or the three secrets. Fix and
  redeploy/re-set the secret.
- **CORS error in the browser console** - the site's origin isn't in
  `ALLOWED_ORIGIN`. Make sure it exactly matches, protocol included
  (`https://mindlap.in`, no trailing slash).
- **`INVALID_OAUTHTOKEN` or similar from Zoho** - the refresh token, client
  ID or client secret is wrong, or the Self Client's scope didn't include
  `ZohoBookings.data.ALL`. Regenerate from step 2.
- **No available times ever show up** - double check the service has staff
  assigned and that staff member has working hours configured in Zoho
  Bookings.
- Logs: `cd worker && npx wrangler tail` streams live Worker logs while you
  test a booking, useful for seeing the raw Zoho error.

## Notes on scope

This Worker exposes four narrow endpoints (list services, list staff,
check availability, create a booking) and nothing else from the Zoho
account. It does not expose Zoho credentials, does not let the browser list
or cancel other people's appointments, and rejects submissions with the
hidden `website` field filled in (a basic spam honeypot). For higher
booking volume, consider adding Cloudflare Turnstile to the form and/or
caching the OAuth access token in Workers KV instead of the current
in-memory best-effort cache.
