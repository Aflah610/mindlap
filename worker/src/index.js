/**
 * Mindlap - Zoho Bookings API proxy
 * -----------------------------------------------------------------------
 * A small Cloudflare Worker that sits between the public website
 * (mindlap.in) and Zoho. It exists so that:
 *
 *   1. Zoho OAuth credentials (client id/secret/refresh token) never
 *      reach the browser - they live only as Worker secrets.
 *   2. The site's own JS only ever talks to endpoints on this Worker,
 *      which are locked down to the site's origin via CORS.
 *
 * Zoho Creator (the "Mindlap Booking Engine" app) is the database of
 * record for customers and appointment history. Zoho Bookings still owns
 * the actual calendar slot. On every booking, this Worker writes to
 * Creator first, then calls Zoho Bookings, then updates that same Creator
 * row with the outcome (Confirmed or Failed) - see /api/book below.
 *
 * Routes:
 *   GET  /api/services                       -> Zoho "services" list
 *   GET  /api/staff?service_id=...            -> Zoho "staffs" list
 *   GET  /api/availability?service_id=&staff_id=&date=YYYY-MM-DD
 *   POST /api/book  { session_token, service_id, staff_id, date, time, name, email,
 *                      notes?, timezone? }
 *   POST /api/otp/send    { phone }
 *   POST /api/otp/verify  { phone, code } -> also returns a session_token
 *   POST /api/sessions    { session_token } -> past/upcoming appointments
 *                                              for that verified phone
 *   POST /api/credits/check { session_token } -> prepaid package credits
 *                                                 (Zoho CRM) for that phone
 *   POST /api/credits/book  { session_token, package_id, service_id,
 *                              staff_id, date, time, name, email, notes? }
 *   POST /api/payment/create-order  { booking_id, amount, currency? }
 *   POST /api/payment/verify        { razorpay_order_id, razorpay_payment_id,
 *                                      razorpay_signature, booking_id? }
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

// --- Razorpay -----------------------------------------------------------

async function razorpayCreateOrder(env, { amount, currency, receipt, notes }) {
  const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount: Math.round(amount * 100), // Razorpay wants the amount in paise
      currency: currency || 'INR',
      receipt,
      notes: notes || {}
    })
  });
  return res.json();
}

function hexEncode(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return hexEncode(signature);
}

// --- Session tokens -------------------------------------------------------
//
// Issued once a phone number is OTP-verified, so "My Sessions" can prove a
// visitor really owns that number instead of just trusting a phone number
// typed into a request. A signed, self-contained token (payload + HMAC),
// no server-side session storage needed.

function base64UrlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  let padded = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) padded += '=';
  return atob(padded);
}

// The browser only keeps this in memory, so a short lifetime costs nothing.
const SESSION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function createSessionToken(env, phone) {
  const payload = JSON.stringify({ phone, exp: Date.now() + SESSION_TOKEN_TTL_MS });
  const encodedPayload = base64UrlEncode(payload);
  const signature = await hmacSha256Hex(env.SESSION_TOKEN_SECRET, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

async function verifySessionToken(env, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;

  const expectedSignature = await hmacSha256Hex(env.SESSION_TOKEN_SECRET, encodedPayload);
  if (!timingSafeEqual(expectedSignature, signature)) return null;

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch (err) {
    return null;
  }

  if (!payload || !payload.phone || !payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

// --- Zoho Creator (the real customer/appointment database) --------------
//
// Zoho Bookings still owns the actual calendar slot; Zoho Creator is the
// database of record for customers and appointment history. A booking
// always writes to Creator first (as a "Creating Appointment" row), then
// calls Zoho Bookings, then updates that same Creator row to Confirmed or
// Failed - so every attempt is logged even if Zoho Bookings rejects it.

let cachedCreatorToken = null; // { token, expiresAt }

async function getCreatorAccessToken(env) {
  const now = Date.now();
  if (cachedCreatorToken && cachedCreatorToken.expiresAt > now + 30_000) {
    return cachedCreatorToken.token;
  }

  const dc = env.ZOHO_DC || 'com';
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    refresh_token: env.ZOHO_CREATOR_REFRESH_TOKEN
  });

  const res = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token?${params.toString()}`, { method: 'POST' });
  const data = await res.json();

  if (!data.access_token) {
    throw new Error('Zoho Creator OAuth token refresh failed: ' + JSON.stringify(data));
  }

  cachedCreatorToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ? data.expires_in * 1000 : 55 * 60 * 1000)
  };
  return cachedCreatorToken.token;
}

function creatorApiBase(env) {
  const dc = env.ZOHO_DC || 'com';
  const owner = env.ZOHO_CREATOR_OWNER;
  const app = env.ZOHO_CREATOR_APP;
  return `https://www.zohoapis.${dc}/creator/v2.1/data/${owner}/${app}`;
}

async function creatorQuery(env, reportName, criteria) {
  const token = await getCreatorAccessToken(env);
  const url = new URL(`${creatorApiBase(env)}/report/${reportName}`);
  if (criteria) url.searchParams.set('criteria', criteria);
  const res = await fetch(url.toString(), { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  const data = await res.json();
  return (data && data.data) || [];
}

async function creatorCreate(env, formName, fields) {
  const token = await getCreatorAccessToken(env);
  const res = await fetch(`${creatorApiBase(env)}/form/${formName}`, {
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: fields })
  });
  return res.json();
}

async function creatorUpdate(env, reportName, recordId, fields) {
  const token = await getCreatorAccessToken(env);
  const res = await fetch(`${creatorApiBase(env)}/report/${reportName}/${recordId}`, {
    method: 'PATCH',
    headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: fields })
  });
  return res.json();
}

/** "10:00" + 60 -> "11:00" (wraps at 24h, which is fine for same-day sessions) */
function addMinutesToTime(hhmm, minutesToAdd) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (h * 60 + m + minutesToAdd) % (24 * 60);
  const outH = Math.floor(total / 60);
  const outM = total % 60;
  return `${String(outH).padStart(2, '0')}:${String(outM).padStart(2, '0')}`;
}

/** Current time in the "dd-MMM-yyyy HH:mm:ss" format Zoho Creator datetime fields expect. */
function creatorNow() {
  const d = new Date();
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mon = MONTHS[d.getUTCMonth()];
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${dd}-${mon}-${yyyy} ${hh}:${mi}:${ss}`;
}

/** Keeps phone numbers consistent so the same customer is always matched. */
function normalizePhone(phone) {
  const trimmed = String(phone || '').trim().replace(/[^\d+]/g, '');
  return trimmed;
}

/** Normalized E.164 ("+919876543210") or null. India numbers must be exactly 10 digits. */
function parseE164(phone) {
  const normalized = normalizePhone(phone);
  if (!/^\+[1-9]\d{6,14}$/.test(normalized)) return null;
  if (normalized.startsWith('+91') && normalized.length !== 13) return null;
  return normalized;
}

// Zoho's Send_OTP / Verify_OTP return raw text (sometimes including Meta API
// internals). Only these known outcomes are shown to customers as-is.
const OTP_CUSTOMER_MESSAGES = [
  [/wait a minute/i, 'Please wait a minute before requesting another code.'],
  [/too many codes/i, 'Too many codes requested. Please try again in a little while.'],
  [/too many incorrect/i, 'Too many incorrect attempts. Please request a new code.'],
  [/expired/i, 'This code has expired. Please request a new one.'],
  [/already used/i, 'This code was already used. Please request a new one.'],
  [/incorrect otp/i, 'That code is incorrect. Please check it and try again.'],
  [/no otp record/i, 'Please request a code first.']
];

function customerOtpMessage(rawResult, fallback) {
  const match = OTP_CUSTOMER_MESSAGES.find(([pattern]) => pattern.test(rawResult));
  return match ? match[1] : fallback;
}

async function callOtpApi(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  return String((data && data.result) || '');
}

/** Finds the Creator record for a therapist/service by its Zoho Bookings ID. */
async function findCreatorRecordByBookingsId(env, reportName, fieldName, bookingsId) {
  const rows = await creatorQuery(env, reportName, `(${fieldName}=="${bookingsId}")`);
  return rows[0] || null;
}

/** Finds an existing customer by phone, or creates one. Returns the record ID. */
async function findOrCreateCustomer(env, { phone, name, email }) {
  const normalized = normalizePhone(phone);
  const todayCreator = toZohoDate(new Date().toISOString().slice(0, 10));

  const existing = await creatorQuery(
    env,
    'customers_Report',
    `(phone_number=="${normalized}" || whatsapp_number=="${normalized}")`
  );

  if (existing.length) {
    const record = existing[0];
    const currentTotal = Number(record.total_appointments) || 0;
    await creatorUpdate(env, 'customers_Report', record.ID, {
      last_booking_date: todayCreator,
      total_appointments: currentTotal + 1
    });
    return record.ID;
  }

  const created = await creatorCreate(env, 'customers', {
    full_name: { first_name: name || 'Guest' },
    phone_number: normalized,
    whatsapp_number: normalized,
    email: email || '',
    authentication_status: 'Not Verified',
    customer_status: 'Active',
    first_booking_date: todayCreator,
    last_booking_date: todayCreator,
    total_appointments: 1
  });

  if (!created || !created.data || !created.data.ID) {
    throw new Error('Could not create Zoho Creator customer record: ' + JSON.stringify(created));
  }
  return created.data.ID;
}

/**
 * Records a Creator sync failure into the "Zoho Sync Error Log" form so it's
 * visible somewhere instead of only failing silently. Never throws itself -
 * if logging the error also fails, there's genuinely nothing more to do.
 */
async function logSyncError(env, { operation, message, phone, bookingId }) {
  try {
    await creatorCreate(env, 'Zoho_Sync_Error_Log', {
      error_timestamp: creatorNow(),
      operation_type: operation,
      // "status" is left unset here - its choice list doesn't include a
      // value this code can rely on; set it manually in Zoho when triaging.
      error_message: String(message || '').slice(0, 2000),
      customer_phone: phone || undefined,
      booking_id: bookingId || undefined
    });
  } catch (err) {
    // Nothing more we can do here.
  }
}

// --- Zoho CRM (prepaid package credits) ----------------------------------
//
// Contacts.Package_credit_value is the source of truth for how many
// prepaid sessions a customer has left. Successful_Bookings records say
// *which service* each package covers, and get decremented alongside the
// Contacts total whenever a credit is used.

let cachedCrmToken = null; // { token, expiresAt }

async function getCrmAccessToken(env) {
  const now = Date.now();
  if (cachedCrmToken && cachedCrmToken.expiresAt > now + 30_000) {
    return cachedCrmToken.token;
  }

  const dc = env.ZOHO_DC || 'com';
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    refresh_token: env.ZOHO_CRM_REFRESH_TOKEN
  });

  const res = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token?${params.toString()}`, { method: 'POST' });
  const data = await res.json();

  if (!data.access_token) {
    throw new Error('Zoho CRM OAuth token refresh failed: ' + JSON.stringify(data));
  }

  cachedCrmToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ? data.expires_in * 1000 : 55 * 60 * 1000)
  };
  return cachedCrmToken.token;
}

function crmApiBase(env) {
  const dc = env.ZOHO_DC || 'com';
  return `https://www.zohoapis.${dc}/crm/v2`;
}

/** Search a module by phone number. Returns [] if nothing matches (Zoho answers 204). */
/** searchBy is "phone" (phone-type fields only) or "word" (any text field). */
async function crmSearchByPhone(env, moduleName, phone, fields, searchBy = 'phone') {
  const token = await getCrmAccessToken(env);
  const url = new URL(`${crmApiBase(env)}/${moduleName}/search`);
  url.searchParams.set(searchBy, phone);
  if (fields) url.searchParams.set('fields', fields);

  const res = await fetch(url.toString(), { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  if (res.status === 204) return [];
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`CRM ${moduleName} search failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data.data || [];
}

async function crmUpdateRecord(env, moduleName, recordId, fields) {
  const token = await getCrmAccessToken(env);
  const res = await fetch(`${crmApiBase(env)}/${moduleName}/${recordId}`, {
    method: 'PUT',
    headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [{ id: recordId, ...fields }] })
  });
  return res.json();
}

/**
 * Looks up a customer's prepaid package credits by phone. Returns
 * { hasCredits, totalCredits, contactId, packages: [{ id, service, remaining }] }
 * packages only lists Successful_Bookings rows that still have credit left.
 */
/** Credits from Contacts that aren't tied to a specific Successful_Bookings package. */
const GENERAL_CREDIT_PACKAGE_ID = 'general';

/** Staff may type numbers into CRM as "+919037910639", "919037910639" or "9037910639". */
function crmPhoneVariants(phone) {
  const variants = [phone, phone.replace(/^\+/, '')];
  if (phone.startsWith('+91')) variants.push(phone.slice(3));
  return [...new Set(variants)];
}

async function crmSearchByPhoneVariants(env, moduleName, phone, fields) {
  for (const variant of crmPhoneVariants(phone)) {
    const rows = await crmSearchByPhone(env, moduleName, variant, fields);
    if (rows.length) return rows;
  }
  // Last resort: a word search also covers numbers saved in a non-phone
  // custom field. The full national number is specific enough to match on.
  const national = phone.startsWith('+91') ? phone.slice(3) : phone.replace(/^\+/, '');
  const rows = await crmSearchByPhone(env, moduleName, national, fields, 'word');
  if (rows.length) console.log(`CRM ${moduleName}: found only via word search`, rows.length);
  return rows;
}

async function checkPackageCredits(env, phone) {
  const contacts = await crmSearchByPhoneVariants(env, 'Contacts', phone, 'id,Package_credit_value,Full_Name');
  const contact = contacts[0];
  const totalCredits = contact ? Number(contact.Package_credit_value) || 0 : 0;

  if (!contact || totalCredits <= 0) {
    console.log('Credit check: no contact with credits', { found: Boolean(contact), totalCredits });
    return { hasCredits: false, totalCredits: 0, contactId: contact ? contact.id : null, packages: [] };
  }

  const bookings = await crmSearchByPhoneVariants(
    env,
    'Successful_Bookings',
    phone,
    'id,Service,Package_Credit,Therapist'
  );
  const packages = bookings
    .filter((b) => Number(b.Package_Credit) > 0)
    .map((b) => ({ id: b.id, service: b.Service, remaining: Number(b.Package_Credit) }));

  console.log('Credit check:', {
    totalCredits,
    successfulBookings: bookings.map((b) => ({ service: b.Service, packageCredit: b.Package_Credit })),
    packages: packages.map((p) => ({ service: p.service, remaining: p.remaining }))
  });
  return { hasCredits: true, totalCredits, contactId: contact.id, packages };
}

/** Spends one credit: decrements both the Contacts total and the specific package row. */
async function spendPackageCredit(env, contactId, contactCredits, packageId, packageCredits) {
  await crmUpdateRecord(env, 'Contacts', contactId, { Package_credit_value: Math.max(0, contactCredits - 1) });
  if (packageId) {
    await crmUpdateRecord(env, 'Successful_Bookings', packageId, {
      Package_Credit: Math.max(0, packageCredits - 1)
    });
  }
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
      // Writes to Zoho Creator first (the customer/appointment database),
      // then calls Zoho Bookings to actually reserve the calendar slot, then
      // updates that same Creator row with the outcome. A Creator hiccup
      // never blocks a real booking - it just means that one row won't have
      // a database record, which is logged via error_message where possible.
      if (url.pathname === '/api/book' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const { service_id, staff_id, date, time, name, email, notes, timezone, hp_confirm } = body || {};

        // Honeypot: real users never fill this hidden field in.
        if (hp_confirm) {
          return jsonResponse({ error: 'Rejected' }, 400, headers);
        }

        // The phone number always comes from the OTP-verified token, never
        // from the request body, so a booking can't skip verification.
        const session = await verifySessionToken(env, body.session_token);
        if (!session) {
          return jsonResponse({ error: 'Please verify your phone number again.', reverify: true }, 401, headers);
        }
        const phone = session.phone;

        if (!service_id || !staff_id || !date || !time || !name || !email) {
          return jsonResponse({ error: 'Missing required booking fields' }, 400, headers);
        }

        const time24 = to24Hour(time);
        let creatorAppointmentId = null;

        try {
          const [customerId, serviceRecord, therapistRecord] = await Promise.all([
            findOrCreateCustomer(env, { phone, name, email }),
            findCreatorRecordByBookingsId(env, 'services_Report', 'zoho_bookings_service_id', service_id),
            findCreatorRecordByBookingsId(env, 'therapists_Report', 'zoho_bookings_staff_id', staff_id)
          ]);

          const durationMinutes = Number(serviceRecord && serviceRecord.duration) || 60;
          const endTime24 = addMinutesToTime(time24, durationMinutes);

          const created = await creatorCreate(env, 'appointments', {
            // Customer/Therapist/Service are configured as multi-select
            // lookups in this form, so Zoho expects an array here even
            // though we only ever put one ID in it.
            customer: [customerId],
            therapist: therapistRecord ? [therapistRecord.ID] : undefined,
            service: serviceRecord ? [serviceRecord.ID] : undefined,
            appointment_date: toZohoDate(date),
            start_time: time24,
            end_time: endTime24,
            session_mode: 'Video',
            amount: serviceRecord ? serviceRecord.default_price : undefined,
            payment_status: 'Pending',
            booking_status: 'Creating Appointment',
            // Mandatory on the form but not something the site collects yet.
            Age: '0'
          });
          creatorAppointmentId = created && created.data && created.data.ID;
        } catch (err) {
          // Don't let a Creator problem stop a real booking attempt - just log it.
          await logSyncError(env, {
            operation: 'Create Appointment',
            message: err && err.message ? err.message : String(err),
            phone
          });
        }

        const fromTime = `${toZohoDate(date)} ${time24}:00`;
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
          if (creatorAppointmentId) {
            try {
              await creatorUpdate(env, 'appointments_Report', creatorAppointmentId, {
                zoho_bookings_appointment_id: returnvalue.booking_id,
                booking_status: 'Confirmed',
                confirmed_time: creatorNow()
              });
            } catch (err) {
              // The real booking already succeeded - a Creator update
              // failure here shouldn't be reported back as a failed booking,
              // just logged so it can be fixed manually.
              await logSyncError(env, {
                operation: 'Update Appointment',
                message: err && err.message ? err.message : String(err),
                phone,
                bookingId: returnvalue.booking_id
              });
            }
          }
          return jsonResponse(data, 200, headers);
        }

        const message = (returnvalue && (returnvalue.message || returnvalue.errormessage)) || 'Booking failed';
        const isSlotConflict = /slot/i.test(message) && /(not available|unavailable|already|taken|booked)/i.test(message);

        if (creatorAppointmentId) {
          try {
            await creatorUpdate(env, 'appointments_Report', creatorAppointmentId, {
              booking_status: 'Failed',
              error_message: message
            });
          } catch (err) {
            // The booking already failed for its own reason - log this
            // second failure too so the Creator row isn't silently stuck.
            await logSyncError(env, {
              operation: 'Update Appointment',
              message: err && err.message ? err.message : String(err),
              phone
            });
          }
        }

        return jsonResponse(
          { error: message, slot_conflict: isSlotConflict, raw: data },
          isSlotConflict ? 409 : 400,
          headers
        );
      }

      // --- POST /api/otp/send ---------------------------------------------------
      if (url.pathname === '/api/otp/send' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const phone = parseE164(body.phone);
        if (!phone) {
          return jsonResponse({ success: false, error: 'Please enter a valid phone number.' }, 400, headers);
        }

        let result;
        try {
          result = await callOtpApi(env.ZOHO_CREATOR_SEND_OTP_URL, { Phone: phone });
        } catch (err) {
          console.error('Send_OTP call failed', err);
          return jsonResponse({ success: false, error: 'Could not send a code right now. Please try again.' }, 502, headers);
        }

        if (result.startsWith('SUCCESS')) {
          return jsonResponse({ success: true }, 200, headers);
        }

        // The code is generated and saved before the WhatsApp send is
        // attempted, so a delivery failure still leaves a valid code behind.
        if (/whatsapp/i.test(result)) {
          console.error('WhatsApp delivery failed', result);
          return jsonResponse({
            success: false,
            delivery_failed: true,
            error: "We couldn't deliver the code on WhatsApp."
          }, 502, headers);
        }

        console.error('Send_OTP rejected', result);
        return jsonResponse({ success: false, error: customerOtpMessage(result, 'Could not send a code. Please try again.') }, 400, headers);
      }

      // --- POST /api/otp/verify -------------------------------------------------
      if (url.pathname === '/api/otp/verify' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const phone = parseE164(body.phone);
        const code = String(body.code || '').replace(/\D/g, '');
        if (!phone) {
          return jsonResponse({ success: false, error: 'Please enter a valid phone number.' }, 400, headers);
        }
        // Rejecting malformed codes here means they never cost the customer
        // one of their limited attempts in Verify_OTP.
        if (code.length !== 6) {
          return jsonResponse({ success: false, error: 'Please enter the 6-digit code.' }, 400, headers);
        }

        let result;
        try {
          result = await callOtpApi(env.ZOHO_CREATOR_VERIFY_OTP_URL, { Phone: phone, Entered_OTP: code });
        } catch (err) {
          console.error('Verify_OTP call failed', err);
          return jsonResponse({ success: false, error: 'Could not verify right now. Please try again.' }, 502, headers);
        }

        if (result.startsWith('SUCCESS')) {
          const sessionToken = await createSessionToken(env, phone);
          return jsonResponse({ success: true, phone, session_token: sessionToken }, 200, headers);
        }
        return jsonResponse({ success: false, error: customerOtpMessage(result, 'Verification failed. Please try again.') }, 400, headers);
      }

      // --- POST /api/sessions -----------------------------------------------------
      // "My Sessions": past and upcoming appointments for a verified customer.
      // Requires a session_token from a successful /api/otp/verify - never just
      // a bare phone number, or anyone could look up anyone else's history.
      if (url.pathname === '/api/sessions' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const session = await verifySessionToken(env, body.session_token);
        if (!session) {
          return jsonResponse({ error: 'Please verify your phone number again.', reverify: true }, 401, headers);
        }

        const normalized = normalizePhone(session.phone);
        const customers = await creatorQuery(
          env,
          'customers_Report',
          `(phone_number=="${normalized}" || whatsapp_number=="${normalized}")`
        );
        const customer = customers[0];

        if (!customer) {
          return jsonResponse({ customer: null, upcoming: [], past: [] }, 200, headers);
        }

        const [appointments, services, therapists] = await Promise.all([
          creatorQuery(env, 'appointments_Report', `(customer.ID==${customer.ID})`),
          creatorQuery(env, 'services_Report', ''),
          creatorQuery(env, 'therapists_Report', '')
        ]);

        const serviceNames = {};
        services.forEach((s) => { serviceNames[s.ID] = s.service_name; });
        const therapistNames = {};
        therapists.forEach((t) => { therapistNames[t.ID] = t.therapist_name && t.therapist_name.first_name; });

        const parseZohoDate = (d) => {
          const [dd, mon, yyyy] = String(d || '').split('-');
          const monthIndex = MONTHS.indexOf(mon);
          if (!dd || monthIndex === -1 || !yyyy) return null;
          return new Date(Number(yyyy), monthIndex, Number(dd));
        };

        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const visible = appointments.filter(
          (a) => a.booking_status && a.booking_status !== 'Failed' && a.booking_status !== 'Creating Appointment'
        );

        const enriched = visible
          .map((a) => {
            const serviceId = a.service && a.service[0] && a.service[0].ID;
            const therapistId = a.therapist && a.therapist[0] && a.therapist[0].ID;
            return {
              id: a.ID,
              date: a.appointment_date,
              parsedDate: parseZohoDate(a.appointment_date),
              start_time: a.start_time,
              end_time: a.end_time,
              service_name: serviceNames[serviceId] || 'Session',
              therapist_name: therapistNames[therapistId] || '',
              session_mode: a.session_mode,
              booking_status: a.booking_status,
              payment_status: a.payment_status
            };
          })
          .filter((a) => a.parsedDate);

        const upcoming = enriched
          .filter((a) => a.parsedDate >= startOfToday)
          .sort((a, b) => a.parsedDate - b.parsedDate);
        const past = enriched
          .filter((a) => a.parsedDate < startOfToday)
          .sort((a, b) => b.parsedDate - a.parsedDate);

        const strip = ({ parsedDate, ...rest }) => rest;

        return jsonResponse(
          {
            customer: {
              name: customer.full_name && customer.full_name.first_name,
              phone: customer.phone_number
            },
            upcoming: upcoming.map(strip),
            past: past.map(strip)
          },
          200,
          headers
        );
      }

      // --- POST /api/credits/check -------------------------------------------------
      // After OTP verification, checks whether this phone number has prepaid
      // package credits (Zoho CRM), and if so, which service(s) they cover.
      if (url.pathname === '/api/credits/check' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const session = await verifySessionToken(env, body.session_token);
        if (!session) {
          return jsonResponse({ error: 'Please verify your phone number again.', reverify: true }, 401, headers);
        }

        try {
          const result = await checkPackageCredits(env, session.phone);
          if (!result.hasCredits) {
            return jsonResponse({ has_credits: false }, 200, headers);
          }

          // Resolve each package's Zoho Bookings service_id so the frontend
          // can call the existing /api/staff and /api/availability routes.
          // Service names are typed by hand in CRM (and some contain double
          // spaces), so match ignoring case and spacing.
          const looseName = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
          const allServices = result.packages.length ? await creatorQuery(env, 'services_Report', '') : [];
          const packagesWithServiceId = await Promise.all(
            result.packages.map(async (pkg) => {
              const serviceRecord = allServices.find((s) => looseName(s.service_name) === looseName(pkg.service));
              return {
                package_id: pkg.id,
                service_name: pkg.service,
                remaining: pkg.remaining,
                service_id: serviceRecord ? serviceRecord.zoho_bookings_service_id : null
              };
            })
          );

          const unmatched = packagesWithServiceId.filter((p) => !p.service_id).map((p) => p.service_name);
          if (unmatched.length) {
            console.log('Credit check: package service not found in Creator services_Report', unmatched);
          }

          // Contacts.Package_credit_value is the source of truth. When no
          // Successful_Bookings row pins the credits to a service, offer them
          // as general credits the customer can use on any service.
          const usablePackages = packagesWithServiceId.filter((p) => p.service_id);
          const packages = usablePackages.length
            ? usablePackages
            : [{ package_id: GENERAL_CREDIT_PACKAGE_ID, service_name: null, remaining: result.totalCredits, service_id: null }];

          return jsonResponse(
            {
              has_credits: true,
              total_credits: result.totalCredits,
              packages
            },
            200,
            headers
          );
        } catch (err) {
          console.error('Credit check failed', err && err.message ? err.message : err);
          await logSyncError(env, {
            operation: 'Update Appointment',
            message: 'Credit check failed: ' + (err && err.message ? err.message : String(err)),
            phone: session.phone
          });
          return jsonResponse({ has_credits: false }, 200, headers);
        }
      }

      // --- POST /api/credits/book -------------------------------------------------
      // Books an appointment against a prepaid package credit - no payment
      // step. Re-checks the credit balance server-side rather than trusting
      // whatever the frontend last saw, to avoid spending a credit twice.
      if (url.pathname === '/api/credits/book' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const session = await verifySessionToken(env, body.session_token);
        if (!session) {
          return jsonResponse({ error: 'Please verify your phone number again.', reverify: true }, 401, headers);
        }

        const { package_id, service_id, staff_id, date, time, name, email, notes, hp_confirm } = body || {};
        if (hp_confirm) {
          return jsonResponse({ error: 'Rejected' }, 400, headers);
        }
        if (!package_id || !service_id || !staff_id || !date || !time || !name || !email) {
          return jsonResponse({ error: 'Missing required booking fields' }, 400, headers);
        }

        const phone = session.phone;
        const credits = await checkPackageCredits(env, phone);
        const chosenPackage = package_id === GENERAL_CREDIT_PACKAGE_ID
          ? { id: null, remaining: credits.totalCredits }
          : credits.packages.find((p) => p.id === package_id);

        if (!credits.hasCredits || !chosenPackage || chosenPackage.remaining <= 0) {
          return jsonResponse({ error: 'No remaining credit on that package. Please refresh and try again.' }, 400, headers);
        }

        const time24 = to24Hour(time);
        let creatorAppointmentId = null;

        try {
          const [customerId, serviceRecord, therapistRecord] = await Promise.all([
            findOrCreateCustomer(env, { phone, name, email }),
            findCreatorRecordByBookingsId(env, 'services_Report', 'zoho_bookings_service_id', service_id),
            findCreatorRecordByBookingsId(env, 'therapists_Report', 'zoho_bookings_staff_id', staff_id)
          ]);

          const durationMinutes = Number(serviceRecord && serviceRecord.duration) || 60;
          const endTime24 = addMinutesToTime(time24, durationMinutes);

          const created = await creatorCreate(env, 'appointments', {
            customer: [customerId],
            therapist: therapistRecord ? [therapistRecord.ID] : undefined,
            service: serviceRecord ? [serviceRecord.ID] : undefined,
            appointment_date: toZohoDate(date),
            start_time: time24,
            end_time: endTime24,
            session_mode: 'Video',
            amount: 0,
            payment_status: 'Paid',
            booking_status: 'Creating Appointment',
            Age: '0'
          });
          creatorAppointmentId = created && created.data && created.data.ID;
        } catch (err) {
          await logSyncError(env, {
            operation: 'Create Appointment',
            message: 'Credit booking pre-write failed: ' + (err && err.message ? err.message : String(err)),
            phone
          });
        }

        const fromTime = `${toZohoDate(date)} ${time24}:00`;
        const data = await zohoPostForm(env, 'appointment', {
          service_id,
          staff_id,
          from_time: fromTime,
          timezone: 'Asia/Calcutta',
          notes: notes || undefined,
          customer_details: JSON.stringify({ name, email, phone_number: phone })
        });

        const returnvalue = data && data.response && data.response.returnvalue;

        if (returnvalue && returnvalue.booking_id) {
          if (creatorAppointmentId) {
            try {
              await creatorUpdate(env, 'appointments_Report', creatorAppointmentId, {
                zoho_bookings_appointment_id: returnvalue.booking_id,
                booking_status: 'Confirmed',
                confirmed_time: creatorNow()
              });
            } catch (err) {
              await logSyncError(env, {
                operation: 'Update Appointment',
                message: err && err.message ? err.message : String(err),
                phone,
                bookingId: returnvalue.booking_id
              });
            }
          }

          // Only spend the credit once the real booking is actually confirmed.
          try {
            await spendPackageCredit(env, credits.contactId, credits.totalCredits, chosenPackage.id, chosenPackage.remaining);
          } catch (err) {
            await logSyncError(env, {
              operation: 'Update Appointment',
              message: 'Credit spend failed after successful booking: ' + (err && err.message ? err.message : String(err)),
              phone,
              bookingId: returnvalue.booking_id
            });
          }

          return jsonResponse(data, 200, headers);
        }

        const message = (returnvalue && (returnvalue.message || returnvalue.errormessage)) || 'Booking failed';
        const isSlotConflict = /slot/i.test(message) && /(not available|unavailable|already|taken|booked)/i.test(message);

        if (creatorAppointmentId) {
          try {
            await creatorUpdate(env, 'appointments_Report', creatorAppointmentId, {
              booking_status: 'Failed',
              error_message: message
            });
          } catch (err) {
            await logSyncError(env, {
              operation: 'Update Appointment',
              message: err && err.message ? err.message : String(err),
              phone
            });
          }
        }

        return jsonResponse(
          { error: message, slot_conflict: isSlotConflict, raw: data },
          isSlotConflict ? 409 : 400,
          headers
        );
      }

      // --- POST /api/payment/create-order ---------------------------------------
      if (url.pathname === '/api/payment/create-order' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const bookingId = String(body.booking_id || '').trim();
        const amount = Number(body.amount);
        const currency = String(body.currency || 'INR').trim();

        if (!bookingId || !amount || amount <= 0) {
          return jsonResponse({ error: 'booking_id and a positive amount are required' }, 400, headers);
        }

        const order = await razorpayCreateOrder(env, {
          amount,
          currency,
          receipt: bookingId,
          notes: { booking_id: bookingId }
        });

        if (!order || !order.id) {
          return jsonResponse({ error: (order && order.error && order.error.description) || 'Could not create payment order' }, 400, headers);
        }

        return jsonResponse(
          {
            order_id: order.id,
            amount: order.amount,
            currency: order.currency,
            key_id: env.RAZORPAY_KEY_ID
          },
          200,
          headers
        );
      }

      // --- POST /api/payment/verify ----------------------------------------------
      if (url.pathname === '/api/payment/verify' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const orderId = String(body.razorpay_order_id || '').trim();
        const paymentId = String(body.razorpay_payment_id || '').trim();
        const signature = String(body.razorpay_signature || '').trim();
        const bookingId = String(body.booking_id || '').trim();

        if (!orderId || !paymentId || !signature) {
          return jsonResponse({ error: 'Missing payment verification fields' }, 400, headers);
        }

        // Razorpay signs "order_id|payment_id" with the key secret - if our
        // own computed signature doesn't match, the payment details were
        // tampered with (or forged) and must be rejected.
        const expectedSignature = await hmacSha256Hex(env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`);
        if (expectedSignature !== signature) {
          return jsonResponse({ success: false, error: 'Payment signature verification failed' }, 400, headers);
        }

        // Best-effort: note the confirmed payment on the Zoho Bookings
        // appointment. This is not critical to the payment itself succeeding,
        // so a failure here does not fail the whole request.
        if (bookingId) {
          try {
            await zohoPostForm(env, 'updateappointment', {
              booking_id: bookingId,
              action: 'edit_appointment_info',
              data: JSON.stringify({
                notes: `Paid via Razorpay. Payment ID: ${paymentId}, Order ID: ${orderId}.`
              })
            });
          } catch (err) {
            // Swallow - the payment itself is already verified and real.
          }
        }

        return jsonResponse({ success: true, payment_id: paymentId }, 200, headers);
      }

      return jsonResponse({ error: 'Not found' }, 404, headers);
    } catch (err) {
      console.error('Unhandled Worker error', err);
      return jsonResponse({ error: 'Something went wrong. Please try again.' }, 500, headers);
    }
  }
};
