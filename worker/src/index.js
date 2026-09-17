/**
 * Mindlap - Zoho Bookings API proxy
 * -----------------------------------------------------------------------
 * A small Cloudflare Worker that sits between the public website
 * (mindlap.in) and the Zoho Bookings REST API. It exists so that:
 *
 *   1. Zoho OAuth credentials (client id/secret/refresh token) never
 *      reach the browser - they live only as Worker secrets.
 *   2. The site's own JS only ever talks to endpoints on this Worker,
 *      which are locked down to the site's origin via CORS.
 *
 * Routes:
 *   GET  /api/services                       -> Zoho "services" list
 *   GET  /api/staff?service_id=...            -> Zoho "staffs" list
 *   GET  /api/availability?service_id=&staff_id=&date=YYYY-MM-DD
 *   POST /api/book  { service_id, staff_id, date, time, name, email,
 *                      phone, notes?, timezone? }
 *
 * See ../../docs/zoho-bookings-setup.md for how to configure and deploy
 * this Worker.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Best-effort in-memory token cache. Cloudflare may reuse the same
// isolate across nearby requests, so this often saves a round trip to
// Zoho, but it is never relied upon for correctness - a cold isolate
// simply fetches a fresh token.
let cachedToken = null; // { token, expiresAt }

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || 'null';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

/** "2026-01-28" -> "28-Jan-2026" (the date format Zoho Bookings expects) */
function toZohoDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${String(d).padStart(2, '0')}-${MONTHS[m - 1]}-${y}`;
}

/** Accepts "14:30" or "2:30 PM" and returns 24h "HH:mm" */
function to24Hour(timeStr) {
  const match = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return timeStr;
  let [, hh, mm, ampm] = match;
  hh = parseInt(hh, 10);
  if (ampm) {
    ampm = ampm.toUpperCase();
    if (ampm === 'PM' && hh !== 12) hh += 12;
    if (ampm === 'AM' && hh === 12) hh = 0;
  }
  return `${String(hh).padStart(2, '0')}:${mm}`;
}

async function getAccessToken(env) {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.token;
  }

  const dc = env.ZOHO_DC || 'com';
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    refresh_token: env.ZOHO_REFRESH_TOKEN
  });

  const res = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token?${params.toString()}`, {
    method: 'POST'
  });
  const data = await res.json();

  if (!data.access_token) {
    throw new Error('Zoho OAuth token refresh failed: ' + JSON.stringify(data));
  }

  cachedToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ? data.expires_in * 1000 : 55 * 60 * 1000)
  };
  return cachedToken.token;
}

function zohoApiBase(env) {
  const dc = env.ZOHO_DC || 'com';
  return `https://www.zohoapis.${dc}/bookings/v1/json`;
}

async function zohoGet(env, path, params) {
  const token = await getAccessToken(env);
  const url = new URL(`${zohoApiBase(env)}/${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Zoho-oauthtoken ${token}` }
  });
  return res.json();
}

async function zohoPostForm(env, path, fields) {
  const token = await getAccessToken(env);
  const form = new FormData();
  Object.entries(fields || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') form.append(key, value);
  });
  const res = await fetch(`${zohoApiBase(env)}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    body: form
  });
  return res.json();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    try {
      if (!env.ZOHO_WORKSPACE_ID || !env.ZOHO_CLIENT_ID) {
        return jsonResponse(
          { error: 'Worker is not configured yet. See docs/zoho-bookings-setup.md.' },
          500,
          headers
        );
      }

      // --- GET /api/services -------------------------------------------------
      if (url.pathname === '/api/services' && request.method === 'GET') {
        const data = await zohoGet(env, 'services', { workspace_id: env.ZOHO_WORKSPACE_ID });
        return jsonResponse(data, 200, headers);
      }

      // --- GET /api/staff?service_id= -----------------------------------------
      if (url.pathname === '/api/staff' && request.method === 'GET') {
        const serviceId = url.searchParams.get('service_id');
        const data = await zohoGet(env, 'staffs', {
          workspace_id: env.ZOHO_WORKSPACE_ID,
          service_id: serviceId
        });
        return jsonResponse(data, 200, headers);
      }

      // --- GET /api/availability?service_id=&staff_id=&date= -----------------
      if (url.pathname === '/api/availability' && request.method === 'GET') {
        const serviceId = url.searchParams.get('service_id');
        const staffId = url.searchParams.get('staff_id');
        const date = url.searchParams.get('date'); // YYYY-MM-DD
        if (!serviceId || !staffId || !date) {
          return jsonResponse({ error: 'service_id, staff_id and date are required' }, 400, headers);
        }
        const data = await zohoGet(env, 'availableslots', {
          service_id: serviceId,
          staff_id: staffId,
          selected_date: toZohoDate(date)
        });
        return jsonResponse(data, 200, headers);
      }

      // --- POST /api/book ------------------------------------------------------
      if (url.pathname === '/api/book' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const { service_id, staff_id, date, time, name, email, phone, notes, timezone, hp_confirm } = body || {};

        // Honeypot: real users never fill this hidden field in.
        if (hp_confirm) {
          return jsonResponse({ error: 'Rejected' }, 400, headers);
        }

        if (!service_id || !staff_id || !date || !time || !name || !email || !phone) {
          return jsonResponse({ error: 'Missing required booking fields' }, 400, headers);
        }

        const fromTime = `${toZohoDate(date)} ${to24Hour(time)}:00`;
        const data = await zohoPostForm(env, 'appointment', {
          service_id,
          staff_id,
          from_time: fromTime,
          timezone: timezone || 'Asia/Calcutta',
          notes: notes || undefined,
          customer_details: JSON.stringify({ name, email, phone_number: phone })
        });

        // Zoho always answers HTTP 200 with response.status "success" even
        // when the *booking itself* failed (e.g. someone else just took the
        // slot) - the real outcome is in response.returnvalue. A successful
        // booking always has a booking_id; anything else is a failure, and
        // we translate that into a proper HTTP status so the frontend can't
        // mistake a rejected double-booking for a confirmed one.
        const returnvalue = data && data.response && data.response.returnvalue;
        if (returnvalue && returnvalue.booking_id) {
          return jsonResponse(data, 200, headers);
        }

        const message = (returnvalue && (returnvalue.message || returnvalue.errormessage)) || 'Booking failed';
        const isSlotConflict = /slot/i.test(message) && /(not available|unavailable|already|taken|booked)/i.test(message);
        return jsonResponse(
          { error: message, slot_conflict: isSlotConflict, raw: data },
          isSlotConflict ? 409 : 400,
          headers
        );
      }

      // --- POST /api/otp/send ---------------------------------------------------
      if (url.pathname === '/api/otp/send' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const phone = String(body.phone || '').trim();
        if (!phone) {
          return jsonResponse({ error: 'Phone number is required' }, 400, headers);
        }

        const zohoRes = await fetch(env.ZOHO_CREATOR_SEND_OTP_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ Phone: phone })
        });
        const data = await zohoRes.json().catch(() => ({}));
        const result = String((data && data.result) || '');

        if (result.startsWith('SUCCESS')) {
          return jsonResponse({ success: true, message: result }, 200, headers);
        }
        return jsonResponse({ success: false, error: result || 'Could not send code' }, 400, headers);
      }

      // --- POST /api/otp/verify -------------------------------------------------
      if (url.pathname === '/api/otp/verify' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const phone = String(body.phone || '').trim();
        const code = String(body.code || '').trim();
        if (!phone || !code) {
          return jsonResponse({ error: 'Phone number and code are required' }, 400, headers);
        }

        const zohoRes = await fetch(env.ZOHO_CREATOR_VERIFY_OTP_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ Phone: phone, Entered_OTP: code })
        });
        const data = await zohoRes.json().catch(() => ({}));
        const result = String((data && data.result) || '');

        if (result.startsWith('SUCCESS')) {
          return jsonResponse({ success: true, message: result }, 200, headers);
        }
        return jsonResponse({ success: false, error: result || 'Verification failed' }, 400, headers);
      }

      return jsonResponse({ error: 'Not found' }, 404, headers);
    } catch (err) {
      return jsonResponse({ error: 'Internal error', detail: String((err && err.message) || err) }, 500, headers);
    }
  }
};
