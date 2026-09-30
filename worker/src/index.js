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
 *   GET  /api/availability?service_id=&staff_id=&date=YYYY-MM-DD  (hides held times)
 *   POST /api/slots/hold    { session_token, service_id, staff_id, date, time }
 *   POST /api/slots/release { session_token }
 *   POST /api/book  { session_token, service_id, staff_id, date, time, name, email,
 *                      notes?, timezone? }
 *   POST /api/otp/send    { phone }
 *   POST /api/otp/verify  { phone, code } -> also returns a session_token
 *   POST /api/sessions    { session_token } -> past/upcoming appointments
 *                                              for that verified phone
 *   POST /api/credits/check { session_token } -> { has_credits, credits }
 *                              from Contacts.Package_credit_value (read-only)
 *   POST /api/credits/book  { session_token, service_id,
 *                              staff_id, date, time, name, email, notes? }
 *   POST /api/payment/create-order  { session_token, service_id, staff_id, date,
 *                                      time, name, email, notes? } -> Razorpay order
 *   POST /api/payment/verify        { razorpay_order_id, razorpay_payment_id,
 *                                      razorpay_signature } -> books after payment
 *   POST /api/payment/webhook       Razorpay webhook (payment.captured/authorized)
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
// Read-only. Contacts.Package_credit_value is the only source of truth for
// how many prepaid sessions a customer has left. The website never changes
// it - Zoho CRM itself deducts credits.

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
  return crmSearchByPhone(env, moduleName, national, fields, 'word');
}

/** Returns the Contact's remaining prepaid sessions (0 if none or no contact). */
async function getPackageCredits(env, phone) {
  const contacts = await crmSearchByPhoneVariants(env, 'Contacts', phone, 'id,Package_credit_value');
  const credits = contacts[0] ? Number(contacts[0].Package_credit_value) || 0 : 0;
  console.log('Credit check:', { contactFound: Boolean(contacts[0]), credits });
  return credits;
}

// --- Booking + payment helpers --------------------------------------------
//
// Paid services: the customer pays first (Razorpay Checkout), and the Zoho
// Bookings slot is only reserved once the payment is confirmed. The booking
// details travel in the Razorpay order's notes, so no extra storage is needed. A
// Zoho Creator row is written up front ("Creating Appointment" / Pending)
// and updated when the payment and booking complete.

function errorText(err) {
  return err && err.message ? err.message : String(err);
}

let cachedServices = null; // { list, fetchedAt }

async function getServicesList(env) {
  if (cachedServices && Date.now() - cachedServices.fetchedAt < 5 * 60 * 1000) return cachedServices.list;
  const data = await zohoGet(env, 'services', { workspace_id: env.ZOHO_WORKSPACE_ID });
  const list = (data && data.response && data.response.returnvalue && data.response.returnvalue.data) || [];
  if (list.length) cachedServices = { list, fetchedAt: Date.now() };
  return list;
}

/** Server-side price and length for a Zoho Bookings service - never trust the browser's values. */
async function getServicePrice(env, serviceId) {
  const services = await getServicesList(env);
  const service = services.find((s) => String(s.id) === String(serviceId));
  if (!service) return null;
  const minutes = Number((String(service.duration || '').match(/\d+/) || [])[0]) || 60;
  return { name: service.name, price: Number(service.price) || 0, currency: service.currency || 'INR', duration: minutes };
}

// --- Slot holds -------------------------------------------------------------
//
// Picking a time holds it for that verified phone number so nobody else can
// take it while they fill in details and pay. Holds live in one Durable
// Object (SlotHolds), which handles requests one at a time - so two people
// tapping the same time at the same moment can't both get it. One hold per
// phone: picking a new time replaces the old hold. Holds expire on their own.

const HOLD_MINUTES = 10;
const PAYMENT_HOLD_MINUTES = 20; // Razorpay Checkout can take a while (UPI apps, OTPs)

function timeToMinutes(time24) {
  const [h, m] = String(time24).split(':').map(Number);
  return h * 60 + m;
}

async function holdsCall(env, op, payload) {
  const stub = env.SLOT_HOLDS.get(env.SLOT_HOLDS.idFromName('global'));
  const res = await stub.fetch('https://slot-holds/' + op, { method: 'POST', body: JSON.stringify(payload) });
  return res.json();
}

/** Holds (or re-holds / extends) a slot for this phone. { ok, expiresAt } - ok is false if someone else holds it. */
async function claimSlot(env, { phone, staffId, date, time24, duration, minutes }) {
  if (!env.SLOT_HOLDS) return { ok: true };
  const start = timeToMinutes(time24);
  return holdsCall(env, 'hold', {
    phone,
    staffId: String(staffId),
    date,
    start,
    end: start + (duration || 60),
    ttlMs: (minutes || HOLD_MINUTES) * 60 * 1000
  });
}

async function releaseSlot(env, phone) {
  if (!env.SLOT_HOLDS || !phone) return;
  try {
    await holdsCall(env, 'release', { phone });
  } catch (err) {
    console.error('Could not release slot hold', errorText(err));
  }
}

/** Removes slots that overlap someone's active hold (for a session of `duration` minutes). */
async function withoutHeldSlots(env, staffId, date, slots, duration) {
  if (!env.SLOT_HOLDS || !Array.isArray(slots) || !slots.length) return slots;
  const { holds } = await holdsCall(env, 'list', { staffId: String(staffId), date });
  if (!holds || !holds.length) return slots;
  return slots.filter((slot) => {
    const start = timeToMinutes(to24Hour(slot));
    const end = start + duration;
    return !holds.some((h) => h.start < end && start < h.end);
  });
}

export class SlotHolds {
  constructor(state) {
    this.state = state;
  }

  async load() {
    const now = Date.now();
    const holds = ((await this.state.storage.get('holds')) || []).filter((h) => h.expiresAt > now);
    return holds;
  }

  async fetch(request) {
    const op = new URL(request.url).pathname.slice(1);
    const body = await request.json().catch(() => ({}));
    let holds = await this.load();
    const reply = (data) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

    if (op === 'hold') {
      const { phone, staffId, date, start, end, ttlMs } = body;
      const taken = holds.some((h) => h.phone !== phone && h.staffId === staffId && h.date === date && h.start < end && start < h.end);
      if (taken) return reply({ ok: false });
      const mine = holds.find((h) => h.phone === phone && h.staffId === staffId && h.date === date && h.start === start);
      const expiresAt = Math.max(Date.now() + ttlMs, mine ? mine.expiresAt : 0);
      holds = holds.filter((h) => h.phone !== phone);
      holds.push({ phone, staffId, date, start, end, expiresAt });
      await this.state.storage.put('holds', holds);
      return reply({ ok: true, expiresAt });
    }

    if (op === 'release') {
      await this.state.storage.put('holds', holds.filter((h) => h.phone !== body.phone));
      return reply({ ok: true });
    }

    if (op === 'list') {
      return reply({
        holds: holds
          .filter((h) => h.staffId === body.staffId && h.date === body.date)
          .map(({ start, end }) => ({ start, end }))
      });
    }

    return reply({ error: 'unknown op' });
  }
}

async function isSlotAvailable(env, serviceId, staffId, date, time24) {
  const data = await zohoGet(env, 'availableslots', {
    service_id: serviceId,
    staff_id: staffId,
    selected_date: toZohoDate(date)
  });
  const slots = (data && data.response && data.response.returnvalue && data.response.returnvalue.data) || [];
  return Array.isArray(slots) && slots.some((slot) => to24Hour(slot) === time24);
}

/** Writes the "Creating Appointment" row to Creator. Returns its ID, or null (logged) on failure. */
async function createCreatorAppointment(env, { phone, name, email, serviceId, staffId, date, time24, amount, paymentStatus }) {
  try {
    const [customerId, serviceRecord, therapistRecord] = await Promise.all([
      findOrCreateCustomer(env, { phone, name, email }),
      findCreatorRecordByBookingsId(env, 'services_Report', 'zoho_bookings_service_id', serviceId),
      findCreatorRecordByBookingsId(env, 'therapists_Report', 'zoho_bookings_staff_id', staffId)
    ]);
    const durationMinutes = Number(serviceRecord && serviceRecord.duration) || 60;

    const created = await creatorCreate(env, 'appointments', {
      // Customer/Therapist/Service are multi-select lookups in this form,
      // so Zoho expects an array even though there's only ever one ID.
      customer: [customerId],
      therapist: therapistRecord ? [therapistRecord.ID] : undefined,
      service: serviceRecord ? [serviceRecord.ID] : undefined,
      appointment_date: toZohoDate(date),
      start_time: time24,
      end_time: addMinutesToTime(time24, durationMinutes),
      session_mode: 'Video',
      amount,
      payment_status: paymentStatus,
      booking_status: 'Creating Appointment',
      // Mandatory on the form but not something the site collects yet.
      Age: '0'
    });
    return (created && created.data && created.data.ID) || null;
  } catch (err) {
    await logSyncError(env, { operation: 'Create Appointment', message: errorText(err), phone });
    return null;
  }
}

async function updateCreatorAppointment(env, creatorId, fields, { phone, bookingId } = {}) {
  if (!creatorId) return;
  try {
    await creatorUpdate(env, 'appointments_Report', creatorId, fields);
  } catch (err) {
    await logSyncError(env, { operation: 'Update Appointment', message: errorText(err), phone, bookingId });
  }
}

/**
 * Reserves the slot in Zoho Bookings. Zoho answers HTTP 200 even when the
 * booking itself failed, so success means a booking_id came back.
 */
async function bookInZoho(env, { serviceId, staffId, date, time24, name, email, phone, notes }) {
  const data = await zohoPostForm(env, 'appointment', {
    service_id: serviceId,
    staff_id: staffId,
    from_time: `${toZohoDate(date)} ${time24}:00`,
    timezone: 'Asia/Calcutta',
    notes: notes || undefined,
    customer_details: JSON.stringify({ name, email, phone_number: phone })
  });
  const returnvalue = (data && data.response && data.response.returnvalue) || {};
  if (returnvalue.booking_id) {
    return { ok: true, bookingId: returnvalue.booking_id, data };
  }
  const message = returnvalue.message || returnvalue.errormessage || 'Booking failed';
  const slotConflict = /slot/i.test(message) && /(not available|unavailable|already|taken|booked)/i.test(message);
  return { ok: false, message, slotConflict, data };
}

async function razorpayRequest(env, method, path, body) {
  const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
  const res = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Razorpay ${method} ${path} failed: ${(data.error && data.error.description) || res.status}`);
  }
  return data;
}

function constantTimeEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Turns a successful Razorpay payment into a real booking. Safe to call more
 * than once for the same order (the browser and the webhook both call it):
 * the Zoho booking ID is saved on the order's notes and reused.
 *
 * Returns { status: 'booked' | 'refunded' | 'pending' | 'invalid', ... }
 */
async function finalizePaidBooking(env, orderId, paymentId) {
  const [order, payment] = await Promise.all([
    razorpayRequest(env, 'GET', `orders/${orderId}`),
    razorpayRequest(env, 'GET', `payments/${paymentId}`)
  ]);
  const notes = order.notes || {};

  if (payment.order_id !== orderId || Number(payment.amount) !== Number(order.amount)) {
    return { status: 'invalid', message: 'Payment does not match this order.' };
  }
  if (notes.booking_id) {
    return { status: 'booked', bookingId: notes.booking_id };
  }
  if (payment.status !== 'captured' && payment.status !== 'authorized') {
    return { status: 'pending', message: `Payment is ${payment.status}.` };
  }

  const booking = {
    serviceId: notes.service_id,
    staffId: notes.staff_id,
    date: notes.date,
    time24: notes.time,
    name: notes.name,
    email: notes.email,
    phone: notes.phone,
    notes: [notes.customer_notes, `Paid via Razorpay. Payment ID: ${paymentId}, Order ID: ${orderId}.`]
      .filter(Boolean)
      .join('\n')
  };
  const creatorId = notes.creator_id || null;
  const logContext = { phone: booking.phone };

  const result = await bookInZoho(env, booking);
  // Booked or not, this customer's hold has done its job.
  await releaseSlot(env, booking.phone);

  if (result.ok) {
    // Payments that are only authorized must be captured, or Razorpay
    // releases the money back to the customer after a few days.
    if (payment.status === 'authorized') {
      try {
        await razorpayRequest(env, 'POST', `payments/${paymentId}/capture`, { amount: payment.amount, currency: payment.currency });
      } catch (err) {
        await logSyncError(env, { operation: 'Update Appointment', message: 'Payment capture failed: ' + errorText(err), phone: booking.phone, bookingId: result.bookingId });
      }
    }
    try {
      await razorpayRequest(env, 'PATCH', `orders/${orderId}`, { notes: { ...notes, booking_id: result.bookingId } });
    } catch (err) {
      console.error('Could not save booking_id on order', orderId, errorText(err));
    }
    await updateCreatorAppointment(env, creatorId, {
      zoho_bookings_appointment_id: result.bookingId,
      booking_status: 'Confirmed',
      payment_status: 'Paid',
      confirmed_time: creatorNow()
    }, { ...logContext, bookingId: result.bookingId });
    return { status: 'booked', bookingId: result.bookingId };
  }

  // The slot may have been taken by a parallel call for this same order
  // (browser + webhook). Re-check before treating it as a real failure.
  const latest = await razorpayRequest(env, 'GET', `orders/${orderId}`).catch(() => null);
  if (latest && latest.notes && latest.notes.booking_id) {
    return { status: 'booked', bookingId: latest.notes.booking_id };
  }

  // Paid but the slot couldn't be booked (usually someone took it while the
  // customer was paying) - give the money back.
  let refunded = false;
  try {
    if (payment.status === 'captured') {
      await razorpayRequest(env, 'POST', `payments/${paymentId}/refund`, { notes: { reason: result.message.slice(0, 200) } });
    }
    // An uncaptured (authorized) payment is released back automatically.
    refunded = true;
  } catch (err) {
    await logSyncError(env, { operation: 'Update Appointment', message: `REFUND NEEDED - payment ${paymentId}: ${errorText(err)}`, phone: booking.phone });
  }
  await updateCreatorAppointment(env, creatorId, {
    booking_status: 'Failed',
    error_message: `${result.message} (payment ${paymentId} ${refunded ? 'refunded' : 'NOT refunded - refund manually'})`
  }, logContext);
  await logSyncError(env, {
    operation: 'Create Appointment',
    message: `Paid booking failed: ${result.message}. Payment ${paymentId} ${refunded ? 'refunded automatically' : 'needs a manual refund'}.`,
    phone: booking.phone
  });
  return { status: 'refunded', slotConflict: result.slotConflict, refunded, message: result.message };
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
        const returnvalue = data && data.response && data.response.returnvalue;
        if (returnvalue && Array.isArray(returnvalue.data) && returnvalue.data.length) {
          try {
            const service = await getServicePrice(env, serviceId);
            returnvalue.data = await withoutHeldSlots(env, staffId, date, returnvalue.data, (service && service.duration) || 60);
          } catch (err) {
            // Holds are a courtesy; never block showing times because of them.
            console.error('Slot hold filter failed', errorText(err));
          }
        }
        return jsonResponse(data, 200, headers);
      }

      // --- POST /api/slots/hold ---------------------------------------------------
      // Holds a time for this verified phone for HOLD_MINUTES while they finish
      // booking. Picking another time replaces the hold.
      if (url.pathname === '/api/slots/hold' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const session = await verifySessionToken(env, body.session_token);
        if (!session) {
          return jsonResponse({ error: 'Please verify your phone number again.', reverify: true }, 401, headers);
        }
        const { service_id, staff_id, date, time } = body;
        if (!service_id || !staff_id || !date || !time) {
          return jsonResponse({ error: 'service_id, staff_id, date and time are required' }, 400, headers);
        }
        const time24 = to24Hour(time);
        const [service, slotFree] = await Promise.all([
          getServicePrice(env, service_id),
          isSlotAvailable(env, service_id, staff_id, date, time24)
        ]);
        if (!service) {
          return jsonResponse({ error: 'That session is no longer available.' }, 400, headers);
        }
        const takenMessage = 'Someone just picked this time. Please choose another.';
        if (!slotFree) {
          return jsonResponse({ error: takenMessage, slot_conflict: true }, 409, headers);
        }
        const hold = await claimSlot(env, { phone: session.phone, staffId: staff_id, date, time24, duration: service.duration });
        if (!hold.ok) {
          return jsonResponse({ error: takenMessage, slot_conflict: true }, 409, headers);
        }
        return jsonResponse({ held: true, held_until: hold.expiresAt || null, hold_minutes: HOLD_MINUTES }, 200, headers);
      }

      // --- POST /api/slots/release ------------------------------------------------
      if (url.pathname === '/api/slots/release' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const session = await verifySessionToken(env, body.session_token);
        if (session) await releaseSlot(env, session.phone);
        return jsonResponse({ released: true }, 200, headers);
      }

      // --- POST /api/book ------------------------------------------------------
      // Free services only. Paid services must go through
      // /api/payment/create-order so the customer pays before the slot is
      // booked. Writes to Zoho Creator first, then Zoho Bookings, then
      // updates the Creator row with the outcome.
      if (url.pathname === '/api/book' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const { service_id, staff_id, date, time, name, email, notes, hp_confirm } = body || {};

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

        const service = await getServicePrice(env, service_id);
        if (!service) {
          return jsonResponse({ error: 'That service is no longer available.' }, 400, headers);
        }
        if (service.price > 0) {
          return jsonResponse({ error: 'This session needs payment first.', payment_required: true }, 402, headers);
        }

        const time24 = to24Hour(time);
        const claim = await claimSlot(env, { phone, staffId: staff_id, date, time24, duration: service.duration, minutes: 5 });
        if (!claim.ok) {
          return jsonResponse({ error: 'That time is being booked by someone else. Please pick another time.', slot_conflict: true }, 409, headers);
        }

        const creatorId = await createCreatorAppointment(env, {
          phone, name, email, serviceId: service_id, staffId: staff_id, date, time24, amount: 0, paymentStatus: 'Paid'
        });

        const result = await bookInZoho(env, { serviceId: service_id, staffId: staff_id, date, time24, name, email, phone, notes });
        await releaseSlot(env, phone);

        if (result.ok) {
          await updateCreatorAppointment(env, creatorId, {
            zoho_bookings_appointment_id: result.bookingId,
            booking_status: 'Confirmed',
            confirmed_time: creatorNow()
          }, { phone, bookingId: result.bookingId });
          return jsonResponse(result.data, 200, headers);
        }

        await updateCreatorAppointment(env, creatorId, { booking_status: 'Failed', error_message: result.message }, { phone });
        return jsonResponse(
          { error: result.message, slot_conflict: result.slotConflict },
          result.slotConflict ? 409 : 400,
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
      // After OTP verification, returns Contacts.Package_credit_value (Zoho CRM)
      // for this phone number.
      if (url.pathname === '/api/credits/check' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const session = await verifySessionToken(env, body.session_token);
        if (!session) {
          return jsonResponse({ error: 'Please verify your phone number again.', reverify: true }, 401, headers);
        }

        try {
          const credits = await getPackageCredits(env, session.phone);
          return jsonResponse({ has_credits: credits > 0, credits }, 200, headers);
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
      // Books an appointment with no payment step for a customer who has
      // prepaid credits. Re-checks the balance server-side; never changes it
      // (Zoho CRM deducts credits itself).
      if (url.pathname === '/api/credits/book' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const session = await verifySessionToken(env, body.session_token);
        if (!session) {
          return jsonResponse({ error: 'Please verify your phone number again.', reverify: true }, 401, headers);
        }

        const { service_id, staff_id, date, time, name, email, notes, hp_confirm } = body || {};
        if (hp_confirm) {
          return jsonResponse({ error: 'Rejected' }, 400, headers);
        }
        if (!service_id || !staff_id || !date || !time || !name || !email) {
          return jsonResponse({ error: 'Missing required booking fields' }, 400, headers);
        }

        const phone = session.phone;
        const credits = await getPackageCredits(env, phone);
        if (credits <= 0) {
          return jsonResponse({ error: 'You have no prepaid sessions left. Please refresh and try again.' }, 400, headers);
        }

        const time24 = to24Hour(time);
        const service = await getServicePrice(env, service_id);
        const claim = await claimSlot(env, { phone, staffId: staff_id, date, time24, duration: service && service.duration, minutes: 5 });
        if (!claim.ok) {
          return jsonResponse({ error: 'That time is being booked by someone else. Please pick another time.', slot_conflict: true }, 409, headers);
        }
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
        await releaseSlot(env, phone);

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
      // Step 1 of a paid booking. Checks the slot, writes a Pending row to
      // Creator, and creates a Razorpay order for the service's real price
      // (looked up here, never taken from the browser). The slot is NOT
      // booked yet - that happens in finalizePaidBooking after payment.
      if (url.pathname === '/api/payment/create-order' && request.method === 'POST') {
        if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
          return jsonResponse({ error: 'Online payment is not available yet. Please book via WhatsApp.' }, 503, headers);
        }

        const body = await request.json().catch(() => ({}));
        const { service_id, staff_id, date, time, name, email, notes, hp_confirm } = body || {};
        if (hp_confirm) {
          return jsonResponse({ error: 'Rejected' }, 400, headers);
        }

        const session = await verifySessionToken(env, body.session_token);
        if (!session) {
          return jsonResponse({ error: 'Please verify your phone number again.', reverify: true }, 401, headers);
        }
        const phone = session.phone;

        if (!service_id || !staff_id || !date || !time || !name || !email) {
          return jsonResponse({ error: 'Missing required booking fields' }, 400, headers);
        }

        const time24 = to24Hour(time);
        const [service, slotFree] = await Promise.all([
          getServicePrice(env, service_id),
          isSlotAvailable(env, service_id, staff_id, date, time24)
        ]);
        if (!service) {
          return jsonResponse({ error: 'That service is no longer available.' }, 400, headers);
        }
        if (service.price <= 0) {
          return jsonResponse({ error: 'This session is free - no payment needed.', free: true }, 400, headers);
        }
        if (!slotFree) {
          return jsonResponse({ error: 'That time was just booked by someone else. Please pick another time.', slot_conflict: true }, 409, headers);
        }
        // Keep the slot for this customer while they pay (re-holds it if their
        // earlier hold ran out and nobody else took it meanwhile).
        const claim = await claimSlot(env, {
          phone, staffId: staff_id, date, time24, duration: service.duration, minutes: PAYMENT_HOLD_MINUTES
        });
        if (!claim.ok) {
          return jsonResponse({ error: 'Your hold on this time ran out and someone else picked it. Please choose another time.', slot_conflict: true }, 409, headers);
        }

        const creatorId = await createCreatorAppointment(env, {
          phone, name, email, serviceId: service_id, staffId: staff_id, date, time24, amount: service.price, paymentStatus: 'Pending'
        });

        // Razorpay notes: max 15 keys, 256 characters each.
        const clip = (value) => String(value || '').slice(0, 250);
        let order;
        try {
          order = await razorpayRequest(env, 'POST', 'orders', {
            amount: Math.round(service.price * 100), // paise
            currency: service.currency,
            receipt: clip(`mindlap-${Date.now()}`).slice(0, 40),
            notes: {
              service_id: clip(service_id),
              staff_id: clip(staff_id),
              date: clip(date),
              time: time24,
              name: clip(name),
              email: clip(email),
              phone,
              customer_notes: clip(notes),
              creator_id: clip(creatorId)
            }
          });
        } catch (err) {
          await updateCreatorAppointment(env, creatorId, { booking_status: 'Failed', error_message: errorText(err) }, { phone });
          await logSyncError(env, { operation: 'Create Appointment', message: 'Razorpay order failed: ' + errorText(err), phone });
          return jsonResponse({ error: 'Could not start the payment. Please try again.' }, 502, headers);
        }

        return jsonResponse(
          {
            order_id: order.id,
            amount: order.amount,
            currency: order.currency,
            key_id: env.RAZORPAY_KEY_ID,
            service_name: service.name,
            prefill: { name, email, contact: phone }
          },
          200,
          headers
        );
      }

      // --- POST /api/payment/verify ----------------------------------------------
      // Step 2, called by the browser right after Razorpay Checkout succeeds.
      // Verifies the signature, then books the slot (or refunds if it's gone).
      if (url.pathname === '/api/payment/verify' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const orderId = String(body.razorpay_order_id || '').trim();
        const paymentId = String(body.razorpay_payment_id || '').trim();
        const signature = String(body.razorpay_signature || '').trim();

        if (!orderId || !paymentId || !signature) {
          return jsonResponse({ error: 'Missing payment verification fields' }, 400, headers);
        }

        // Razorpay signs "order_id|payment_id" with the key secret; a mismatch
        // means the payment details were forged or tampered with.
        const expectedSignature = await hmacSha256Hex(env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`);
        if (!constantTimeEqual(expectedSignature, signature)) {
          return jsonResponse({ success: false, error: 'Payment could not be verified.' }, 400, headers);
        }

        let result;
        try {
          result = await finalizePaidBooking(env, orderId, paymentId);
        } catch (err) {
          // Usually a brief Zoho/Razorpay hiccup; the browser retries, and the
          // retry is safe because finalizePaidBooking never books twice.
          console.error('Payment verify failed', paymentId, errorText(err));
          await logSyncError(env, { operation: 'Create Appointment', message: `Paid booking attempt failed for ${paymentId}: ${errorText(err)}` });
          return jsonResponse({ success: false, retry: true, error: 'Still confirming your booking…' }, 503, headers);
        }
        if (result.status !== 'booked') console.log('Payment verify outcome', paymentId, JSON.stringify(result));
        if (result.status === 'pending') {
          return jsonResponse({ success: false, retry: true, error: result.message }, 202, headers);
        }
        if (result.status === 'booked') {
          return jsonResponse({ success: true, booking_id: result.bookingId, payment_id: paymentId }, 200, headers);
        }
        if (result.status === 'refunded') {
          return jsonResponse({
            success: false,
            refunded: result.refunded,
            slot_conflict: result.slotConflict,
            error: result.refunded
              ? 'Your payment went through, but that time was taken just before we could book it. Your money is being refunded (usually 5-7 working days). Please pick another time.'
              : 'Your payment went through, but we could not book that time. Our team will contact you and refund you.'
          }, 409, headers);
        }
        return jsonResponse({ success: false, error: result.message || 'Payment not completed.' }, 400, headers);
      }

      // --- POST /api/payment/webhook ---------------------------------------------
      // Razorpay calls this directly, so a booking still happens if the
      // customer closes the tab right after paying. Configure it in the
      // Razorpay Dashboard with events payment.captured + payment.authorized.
      if (url.pathname === '/api/payment/webhook' && request.method === 'POST') {
        if (!env.RAZORPAY_WEBHOOK_SECRET) {
          return new Response('Webhook not configured', { status: 503 });
        }
        const rawBody = await request.text();
        const expected = await hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET, rawBody);
        if (!constantTimeEqual(expected, request.headers.get('X-Razorpay-Signature'))) {
          return new Response('Invalid signature', { status: 400 });
        }

        const event = JSON.parse(rawBody);
        const payment = event.payload && event.payload.payment && event.payload.payment.entity;
        if (!payment || !payment.order_id || !['payment.captured', 'payment.authorized'].includes(event.event)) {
          return new Response('Ignored', { status: 200 });
        }

        // Give the customer's own browser the first chance to finish the
        // booking; if it hasn't within ~2 minutes, Razorpay's retry of this
        // webhook will do it. Avoids two parallel booking attempts.
        const ageSeconds = Date.now() / 1000 - Number(payment.created_at || 0);
        if (ageSeconds < 120) {
          const order = await razorpayRequest(env, 'GET', `orders/${payment.order_id}`);
          if (!(order.notes && order.notes.booking_id)) {
            return new Response('Retry later', { status: 503 });
          }
          return new Response('OK', { status: 200 });
        }

        const result = await finalizePaidBooking(env, payment.order_id, payment.id);
        console.log('Webhook finalize', payment.order_id, result.status);
        return new Response('OK', { status: 200 });
      }

      return jsonResponse({ error: 'Not found' }, 404, headers);
    } catch (err) {
      console.error('Unhandled Worker error', err);
      return jsonResponse({ error: 'Something went wrong. Please try again.' }, 500, headers);
    }
  }
};
