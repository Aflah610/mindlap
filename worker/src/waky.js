/**
 * Waky Booking engine (BOOKING_ENGINE = "waky").
 *
 * Waky is the booking system: services, psychologists, working hours, free
 * times, holds, bookings, the 10-minute pay window, resume, packages, credits
 * and "My bookings" all live there (docs/website-api.md in the Waky repo).
 * This Worker keeps only what Waky leaves to the website: the WhatsApp login
 * and Razorpay. After Razorpay takes money it reports the result to Waky.
 *
 * The browser keeps talking to the same /api/* routes as before; with this
 * engine they are answered from Waky instead of Zoho Bookings / Creator.
 * Nothing about a booking is stored here.
 */

const IST_OFFSET_MS = 330 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PKG_ID = /^pkg:([0-9a-f-]{36}):([0-9a-f-]{36})$/i;
// Waky's ids are usually UUIDs, but staff imported from Zoho keep their numeric ids.
const ANY_ID = /^[A-Za-z0-9-]{6,64}$/;
const WAKY_BOOKING_REF = /^wb_([0-9a-f-]{36})$/i;

// ---- Talking to Waky -------------------------------------------------------

async function waky(env, method, path, { body, manageToken, idem } = {}) {
  const base = String(env.WAKY_API_URL || '').replace(/\/+$/, '');
  if (!base || !env.BOOKING_API_KEY) throw new Error('Waky is not configured (WAKY_API_URL / BOOKING_API_KEY)');
  const headers = { Authorization: 'Bearer ' + String(env.BOOKING_API_KEY).trim(), Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (manageToken) headers['X-Manage-Token'] = manageToken;
  if (idem) headers['Idempotency-Key'] = idem;
  const res = await fetch(base + '/api/v1' + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => null);
  const error = json && json.error ? json.error : null;
  const data = json && Object.prototype.hasOwnProperty.call(json, 'data') ? json.data : json;
  return { status: res.status, ok: res.ok, data, error };
}

const typeOf = (name) => (/couple/i.test(String(name || '')) ? 'couple' : 'individual');

let catalogCache = null; // { at, value } per isolate

/**
 * Services and packages in the shape the booking pages already understand
 * (the old Zoho Bookings list). A package becomes one entry per service it
 * covers, with id "pkg:<packageId>:<serviceId>".
 */
// The site used to name Rashin by his Zoho Bookings staff id. Bookings started before book.js matched therapists by
// name may still send it, so it is swapped for the booking app's id on the way in and back on the way out.
// Old Zoho id -> first name of the staff member in the booking app.
const STAFF_ALIASES = { '445145000000031006': 'rishin' };

export async function staffAliases(env) {
  const c = await catalog(env);
  const pairs = [];
  for (const [oldId, first] of Object.entries(STAFF_ALIASES)) {
    const p = c.staff.find((x) => String(x.name || '').trim().split(/[\s-]+/)[0].toLowerCase() === first);
    if (p) pairs.push([oldId, p.id]);
  }
  return pairs;
}

const swapIds = (text, pairs, toNew) =>
  pairs.reduce((t, [oldId, newId]) => (toNew ? t.split(oldId).join(newId) : t.split(newId).join(oldId)), text);

export async function aliasRequest(request, url, pairs) {
  for (const [k, v] of url.searchParams) url.searchParams.set(k, swapIds(v, pairs, true));
  if (request.method !== 'POST' || url.pathname === '/api/payment/webhook') return request;
  const text = await request.clone().text();
  const swapped = swapIds(text, pairs, true);
  return swapped === text ? request : new Request(request, { body: swapped });
}

export async function aliasResponse(response, pairs) {
  if (!/json/i.test(response.headers.get('content-type') || '')) return response;
  const text = await response.text();
  return new Response(swapIds(text, pairs, false), { status: response.status, headers: response.headers });
}

async function catalog(env) {
  if (catalogCache && Date.now() - catalogCache.at < 60 * 1000) return catalogCache.value;
  const [svcRes, pkgRes] = await Promise.all([waky(env, 'GET', '/services'), waky(env, 'GET', '/packages')]);
  if (!svcRes.ok) throw new Error('Waky /services ' + svcRes.status);
  const services = Array.isArray(svcRes.data) ? svcRes.data : [];
  const packages = pkgRes.ok && Array.isArray(pkgRes.data) ? pkgRes.data : [];

  const staffByService = {};
  await Promise.all(services.map(async (s) => {
    const r = await waky(env, 'GET', '/staff?service=' + encodeURIComponent(s.id));
    staffByService[s.id] = r.ok && Array.isArray(r.data) ? r.data : [];
  }));

  const items = [];
  const byId = {};
  for (const s of services) {
    const item = {
      id: s.id,
      kind: 'service',
      name: s.name,
      price: (Number(s.pricePaise) || 0) / 100,
      currency: 'INR',
      duration: (Number(s.durationMin) || 60) + ' mins',
      durationMin: Number(s.durationMin) || 60,
      assigned_staffs: staffByService[s.id].map((p) => p.id),
      questions: s.questions || []
    };
    items.push(item);
    byId[item.id] = item;
  }
  for (const p of packages) {
    const covered = (p.serviceIds && p.serviceIds.length)
      ? services.filter((s) => p.serviceIds.includes(s.id))
      : services.filter((s) => typeOf(s.name) === typeOf(p.name));
    for (const s of covered) {
      let name = String(p.name || 'Package').replace(/ · ₹[\d,]+ tier$/, '');
      if (!/(\d+)\s*session/i.test(name) && p.credits) name = p.credits + ' Session ' + name;
      if (!/package/i.test(name)) name += ' package';
      if (typeOf(s.name) === 'couple' && !/couple/i.test(name)) name = 'Couple ' + name;
      const item = {
        id: 'pkg:' + p.id + ':' + s.id,
        kind: 'package',
        packageId: p.id,
        serviceId: s.id,
        name,
        price: (Number(p.pricePaise) || 0) / 100,
        pricePaise: Number(p.pricePaise) || 0,
        currency: 'INR',
        duration: (Number(s.durationMin) || 60) + ' mins',
        durationMin: Number(s.durationMin) || 60,
        credits: p.credits,
        creditValuePaise: Number(p.creditValuePaise) || 0,
        assigned_staffs: staffByService[s.id].map((x) => x.id)
      };
      items.push(item);
      byId[item.id] = item;
    }
  }
  const staff = {};
  Object.values(staffByService).flat().forEach((p) => { staff[p.id] = { id: p.id, name: p.name }; });
  // Each person's own price per service (or the service's price when they have none).
  const priceOf = {};
  for (const s of services) {
    priceOf[s.id] = { base: Number(s.pricePaise) || 0 };
    for (const p of staffByService[s.id]) priceOf[s.id][p.id] = p.pricePaise == null ? priceOf[s.id].base : Number(p.pricePaise);
  }
  const value = { items, byId, staff: Object.values(staff), priceOf };
  catalogCache = { at: Date.now(), value };
  return value;
}

// The price list as one therapist charges it: their own price for each service, and only the packages made for that
// price (one credit = one of their sessions). Without a therapist, the services' base prices and base packages.
function pricedFor(c, staffId) {
  const priceFor = (serviceId) => {
    const prices = c.priceOf[serviceId] || {};
    return staffId && prices[staffId] !== undefined ? prices[staffId] : prices.base || 0;
  };
  return c.items.flatMap((item) => {
    if (item.kind !== 'package') return [{ ...item, price: priceFor(item.id) / 100 }];
    return item.creditValuePaise === priceFor(item.serviceId) ? [item] : [];
  });
}

/** "pkg:<p>:<s>" or a plain service id -> { serviceId, packageId? } */
function splitItem(id) {
  const m = PKG_ID.exec(String(id || ''));
  if (m) return { packageId: m[1], serviceId: m[2] };
  return UUID.test(String(id || '')) ? { serviceId: String(id) } : null;
}

// ---- Time: the pages use "YYYY-MM-DD" + "10:30 AM" in India time ------------

function istToIso(date, time) {
  const [y, mo, d] = String(date).split('-').map(Number);
  const m = String(time).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!y || !mo || !d || !m) return null;
  let h = Number(m[1]);
  const ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return new Date(Date.UTC(y, mo - 1, d, h, Number(m[2])) - IST_OFFSET_MS).toISOString();
}

function isoToIst(iso) {
  const t = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  const date = t.toISOString().slice(0, 10);
  const h = t.getUTCHours();
  const min = String(t.getUTCMinutes()).padStart(2, '0');
  return {
    date,
    time12: String(h % 12 || 12).padStart(2, '0') + ':' + min + ' ' + (h >= 12 ? 'PM' : 'AM'),
    time24: String(h).padStart(2, '0') + ':' + min
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const zohoDate = (isoDate) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return String(d).padStart(2, '0') + '-' + MONTHS[m - 1] + '-' + y;
};

// ---- Bookings helpers -------------------------------------------------------

async function bookingsForPhone(env, phone, view, strict = false) {
  const r = await waky(env, 'GET', '/bookings?phone=' + encodeURIComponent(phone) + '&view=' + view);
  if (strict && (!r.ok || !Array.isArray(r.data))) throw new Error('Could not load confirmed sessions');
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

/** Every listed booking carries its manageToken, so nothing has to be stored here. */
async function manageTokenFor(env, phone, bookingId) {
  for (const view of ['pending', 'all']) {
    const hit = (await bookingsForPhone(env, phone, view)).find((b) => b.id === bookingId);
    if (hit && hit.manageToken) return hit.manageToken;
  }
  return null;
}

function conflict(r) {
  return r.status === 409 || (r.error && r.error.code === 'conflict');
}

const wakyMessage = (r, fallback) => (r.error && r.error.message) || fallback;

const STATUS_LABEL = { upcoming: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show' };

function bookingLabel(b) {
  if (b.status === 'upcoming' && b.payment && b.payment.status === 'pending') return 'Payment pending';
  if (b.status === 'upcoming' && b.payment && b.payment.status === 'failed') return 'Payment failed';
  return STATUS_LABEL[b.status] || b.status;
}

// ---- Razorpay result -> Waky -----------------------------------------------

function paymentReport(payment) {
  return {
    status: 'paid',
    amountPaise: Number(payment.amount),
    razorpayOrderId: payment.order_id,
    razorpayPaymentId: payment.id,
    method: payment.method || undefined,
    paidAt: new Date((Number(payment.created_at) || Date.now() / 1000) * 1000).toISOString(),
    currency: payment.currency || 'INR'
  };
}

/**
 * Reports a successful Razorpay payment to Waky. Safe to repeat (browser and
 * webhook both call it): Waky records a payment id once.
 * Returns { status: 'booked' | 'needs_rebook' | 'pending' | 'invalid' | 'error', ... }
 */
export async function finalizeWakyPayment(env, h, order, payment) {
  const notes = order.notes || {};
  if (payment.order_id !== order.id || Number(payment.amount) !== Number(order.amount)) {
    return { status: 'invalid', message: 'Payment does not match this order.' };
  }
  if (payment.status !== 'captured' && payment.status !== 'authorized') {
    return { status: 'pending', message: 'Payment is ' + payment.status + '.' };
  }
  if (payment.status === 'authorized') {
    // Capture first: Razorpay gives authorised-only money back after a few days, so nothing counts as paid until the money is
    // actually taken. If the capture call fails, ask Razorpay again (another request may have captured it meanwhile).
    try {
      payment = await h.razorpayRequest(env, 'POST', 'payments/' + payment.id + '/capture', { amount: payment.amount, currency: payment.currency });
    } catch (err) {
      console.error('Capture failed', payment.id, h.errorText(err));
      const now = await h.razorpayRequest(env, 'GET', 'payments/' + payment.id).catch(() => null);
      if (!now || now.status !== 'captured') {
        return { status: 'pending', retry: true, message: 'We could not take the payment yet. Please wait a moment and refresh.' };
      }
      payment = now;
    }
    if (payment.status !== 'captured') return { status: 'pending', retry: true, message: 'Payment is ' + payment.status + '.' };
  }

  if (notes.kind === 'booking') {
    const token = await manageTokenFor(env, notes.phone, notes.waky_booking_id);
    if (!token) return { status: 'error', message: 'Booking not found in Waky.' };
    const r = await waky(env, 'POST', '/bookings/' + notes.waky_booking_id + '/payment', { body: paymentReport(payment), manageToken: token });
    if (r.ok) {
      if (r.data && r.data.warning === 'choose_new_time') return { status: 'needs_rebook', rebookId: 'wb_' + notes.waky_booking_id };
      return { status: 'booked', bookingId: notes.waky_booking_id };
    }
    console.error('Waky payment report failed', r.status, JSON.stringify(r.error));
    return { status: 'error', message: wakyMessage(r, 'Could not confirm the booking.') };
  }

  if (notes.kind === 'package') {
    // Buy the package and book with it in one call. The order id makes retries safe.
    const r = await waky(env, 'POST', '/bookings', {
      idem: 'pkg-' + order.id,
      body: {
        serviceId: notes.service_id,
        staffId: notes.staff_id || undefined,
        start: notes.start,
        holdToken: notes.hold_token || undefined,
        client: { name: notes.name, phone: notes.phone, email: notes.email || undefined, whatsappOptIn: true },
        notes: notes.customer_notes || undefined,
        purchase: {
          packageId: notes.package_id,
          amountPaise: Number(payment.amount),
          razorpayPaymentId: payment.id,
          razorpayOrderId: order.id,
          method: payment.method || undefined,
          paidAt: paymentReport(payment).paidAt
        }
      }
    });
    if (r.ok) return { status: 'booked', bookingId: r.data && r.data.booking && r.data.booking.id };
    if (conflict(r)) return { status: 'needs_rebook', rebookId: order.id }; // the package stays with the client as credit
    console.error('Waky package booking failed', r.status, JSON.stringify(r.error));
    return { status: 'error', message: wakyMessage(r, 'Could not confirm the booking.') };
  }

  return { status: 'invalid', message: 'Unknown order.' };
}

// ---- Routes -----------------------------------------------------------------

/**
 * Answers the booking routes from Waky. Returns null for routes it doesn't
 * own (OTP login stays in index.js), so the caller falls through.
 */
export async function handleWaky(request, env, url, headers, h) {
  const { jsonResponse, verifySessionToken, razorpayRequest, hmacSha256Hex, constantTimeEqual, errorText } = h;
  const json = (data, status) => jsonResponse(data, status || 200, headers);
  const path = url.pathname;
  const wrap = (data) => ({ response: { returnvalue: { data } } }); // the old Zoho list shape

  const session = async () => {
    const body = await request.clone().json().catch(() => ({}));
    const s = await verifySessionToken(env, body.session_token);
    return { body, s };
  };
  const reverify = () => json({ error: 'Please verify your phone number again.', reverify: true }, 401);

  // -- Catalogue ---------------------------------------------------------------
  if (path === '/api/services' && request.method === 'GET') {
    const c = await catalog(env);
    return json(wrap(pricedFor(c, url.searchParams.get('staff_id'))));
  }

  if (path === '/api/staff' && request.method === 'GET') {
    const c = await catalog(env);
    const sid = url.searchParams.get('service_id');
    const list = sid && c.byId[sid] ? c.staff.filter((p) => c.byId[sid].assigned_staffs.includes(p.id)) : c.staff;
    return json(wrap(list));
  }

  if (path === '/api/availability' && request.method === 'GET') {
    const item = splitItem(url.searchParams.get('service_id'));
    const staffId = url.searchParams.get('staff_id');
    const date = url.searchParams.get('date');
    if (!item || !ANY_ID.test(String(staffId || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
      return json({ error: 'service_id, staff_id and date are required' }, 400);
    }
    const from = istToIso(date, '00:00');
    const to = new Date(new Date(from).getTime() + 24 * 60 * 60 * 1000).toISOString();
    const r = await waky(env, 'GET', '/availability?serviceId=' + item.serviceId + '&staffId=' + staffId +
      '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to));
    if (!r.ok) return json({ error: wakyMessage(r, 'Could not load times') }, 502);
    const slots = ((r.data && r.data.slots) || [])
      .filter((s) => !s.staffIds || s.staffIds.includes(staffId))
      .map((s) => isoToIst(s.start))
      .filter((t) => t.date === date)
      .map((t) => t.time12);
    return json(wrap(slots));
  }

  // -- Holding a time while the client fills in details ------------------------
  if (path === '/api/slots/hold' && request.method === 'POST') {
    const { body, s } = await session();
    if (!s) return reverify();
    const item = splitItem(body.service_id);
    const start = istToIso(body.date, body.time);
    if (!item || !ANY_ID.test(String(body.staff_id || '')) || !start) return json({ error: 'service_id, staff_id, date and time are required' }, 400);
    if (body.hold_token) await waky(env, 'DELETE', '/slot-holds/' + encodeURIComponent(body.hold_token)).catch(() => {});
    const r = await waky(env, 'POST', '/slot-holds', { body: { serviceId: item.serviceId, staffId: body.staff_id, start } });
    if (!r.ok) {
      return conflict(r)
        ? json({ error: 'Someone just picked this time. Please choose another.', slot_conflict: true }, 409)
        : json({ error: wakyMessage(r, 'Could not hold that time.') }, 400);
    }
    const until = Date.parse(r.data.expiresAt);
    return json({ held: true, held_until: until, hold_minutes: Math.round((until - Date.now()) / 60000), hold_token: r.data.token });
  }

  if (path === '/api/slots/release' && request.method === 'POST') {
    const { body } = await session();
    if (body.hold_token) await waky(env, 'DELETE', '/slot-holds/' + encodeURIComponent(body.hold_token)).catch(() => {});
    return json({ released: true });
  }

  // -- Prepaid credits -----------------------------------------------------------
  if (path === '/api/credits/check' && request.method === 'POST') {
    const { s } = await session();
    if (!s) return reverify();
    const r = await waky(env, 'GET', '/credits?phone=' + encodeURIComponent(s.phone));
    if (!r.ok) return json({ error: 'Could not load your balance. Please try again shortly.' }, 503);
    const balance = (r.data.packages || []).reduce((n, p) => n + Math.round((Number(p.creditsLeft) || 0) * 1000), 0) / 1000;
    // Preserve the existing whole-session routing field; the account displays the exact credit balance.
    const credits = Math.floor(balance);
    return json({ has_credits: credits > 0, credits, credit_balance: balance, wallet_credit: (Number(r.data.walletPaise) || 0) / 100 });
  }

  // -- Booking with nothing to pay (free session or fully covered by credit) ----
  if ((path === '/api/book' || path === '/api/credits/book') && request.method === 'POST') {
    const { body, s } = await session();
    if (!s) return reverify();
    if (body.hp_confirm) return json({ error: 'Rejected' }, 400);
    const item = splitItem(body.service_id);
    const start = istToIso(body.date, body.time);
    if (!item || item.packageId || !ANY_ID.test(String(body.staff_id || '')) || !start || !body.name) {
      return json({ error: 'Missing required booking fields' }, 400);
    }
    // Never leave an unpaid booking behind: check first that nothing is due.
    const q = await waky(env, 'GET', '/credits/quote?phone=' + encodeURIComponent(s.phone) + '&serviceId=' + item.serviceId + '&staffId=' + body.staff_id);
    const c = await catalog(env);
    const price = c.byId[item.serviceId] ? c.byId[item.serviceId].price : null;
    const due = q.ok && q.data && q.data.duePaise !== null ? Number(q.data.duePaise) : price === 0 ? 0 : null;
    if (due === null || due > 0) {
      return json({ error: 'This session needs payment. Please go back and choose it again.', payment_required: true }, 402);
    }
    const r = await waky(env, 'POST', '/bookings', {
      idem: String(body.attempt_key || crypto.randomUUID()),
      body: {
        serviceId: item.serviceId,
        staffId: body.staff_id,
        start,
        holdToken: body.hold_token || undefined,
        client: { name: String(body.name).slice(0, 120), phone: s.phone, email: body.email || undefined, whatsappOptIn: true },
        notes: body.notes || undefined
      }
    });
    if (!r.ok) {
      return conflict(r)
        ? json({ error: 'That time was just taken. Please choose another time.', slot_conflict: true }, 409)
        : json({ error: wakyMessage(r, 'Booking failed') }, 400);
    }
    return json({ success: true, booking_id: r.data.booking.id, reference: r.data.booking.reference });
  }

  // CCD-created bookings: a payment-only capability replaces OTP, never an account session.
  if (path === '/api/payment/ccd-order' && request.method === 'POST') {
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.SLOT_HOLDS || !h.holdsCall) return json({ error: 'Online payment is temporarily unavailable.' }, 503);
    const body = await request.clone().json().catch(() => ({}));
    if (!UUID.test(String(body.booking_id || '')) || typeof body.collection_token !== 'string' || body.collection_token.length > 100) return json({ error: 'Invalid payment link.' }, 400);
    const r = await waky(env, 'POST', '/bookings/' + body.booking_id + '/collection', { body: { token: body.collection_token } });
    if (!r.ok) return json({ error: 'This payment link is unavailable. Ask your coordinator for a new link.' }, 400);
    const b = r.data;
    if (b.status === 'paid') return json({ booked: true });
    if (b.status !== 'pending' || !Number.isSafeInteger(b.amountPaise) || b.amountPaise <= 0) return json({ error: 'No payment is due.' }, 409);
    const key = b.id + ':' + b.amountPaise;
    const claimed = await h.holdsCall(env, 'collection-order', { key });
    if (!claimed.orderId && !claimed.lease) return json({ error: 'Payment is being prepared. Please try again in a moment.' }, 409);
    let order;
    if (claimed.orderId) order = await razorpayRequest(env, 'GET', 'orders/' + claimed.orderId);
    else {
      order = await razorpayRequest(env, 'POST', 'orders', {
        amount: b.amountPaise, currency: 'INR', receipt: ('ccd-' + b.id).slice(0, 40),
        notes: { engine: 'waky', kind: 'booking', ccd_collection: '1', waky_booking_id: b.id, phone: b.phone }
      });
      // Do not expose an order until it is persisted: retries then reuse it rather than charging twice.
      const saved = await h.holdsCall(env, 'collection-order', { key, lease: claimed.lease, orderId: order.id });
      if (!saved.ok) return json({ error: 'Payment is being prepared. Please try again shortly.' }, 503);
    }
    if (Number(order.amount) !== b.amountPaise || order.notes?.waky_booking_id !== b.id || order.notes?.ccd_collection !== '1') return json({ error: 'Payment order does not match this booking.' }, 409);
    if (['attempted', 'paid'].includes(order.status)) {
      // Check existing authorisations too: a capture retry must not offer a second payment attempt.
      const attempts = await razorpayRequest(env, 'GET', 'orders/' + order.id + '/payments');
      const existingPayment = (attempts.items || []).find(p => ['authorized', 'captured'].includes(p.status));
      if (existingPayment) {
        const result = await finalizeWakyPayment(env, h, order, existingPayment);
        if (result.status === 'booked') return json({ booked: true });
        return json({ error: 'Payment is being confirmed. Refresh shortly; do not pay again.' }, 409);
      }
      if (order.status === 'paid') return json({ error: 'Payment received and being confirmed. Refresh shortly; do not pay again.' }, 409);
    }
    return json({ order_id: order.id, amount: order.amount, currency: order.currency, key_id: env.RAZORPAY_KEY_ID });
  }

  // -- Paid booking: create (or resume) in Waky, then a Razorpay order ----------
  if (path === '/api/payment/create-order' && request.method === 'POST') {
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      return json({ error: 'Online payment is not available yet. Please book via WhatsApp.' }, 503);
    }
    const { body, s } = await session();
    if (!s) return reverify();
    if (body.hp_confirm) return json({ error: 'Rejected' }, 400);
    const item = splitItem(body.service_id);
    const start = istToIso(body.date, body.time);
    if (!item || !ANY_ID.test(String(body.staff_id || '')) || !start || !body.name) {
      return json({ error: 'Missing required booking fields' }, 400);
    }
    const c = await catalog(env);
    const clip = (v) => String(v || '').slice(0, 250);
    const prefill = { name: body.name, email: body.email || '', contact: s.phone };

    const newOrder = async (amountPaise, notes, label) => razorpayRequest(env, 'POST', 'orders', {
      amount: amountPaise,
      currency: 'INR',
      receipt: ('mindlap-' + Date.now()).slice(0, 40),
      notes: Object.assign({ engine: 'waky', phone: s.phone, name: clip(body.name), email: clip(body.email), service_name: clip(label), staff_name: clip(body.staff_name) }, notes)
    });
    const orderReply = (order, label) => json({
      order_id: order.id, amount: order.amount, currency: order.currency, key_id: env.RAZORPAY_KEY_ID, prefill, service_name: label
    });

    // A package: take the money first, then buy-and-book in one Waky call (see finalizeWakyPayment).
    if (item.packageId) {
      const pkg = c.byId[body.service_id];
      if (!pkg || !(pkg.pricePaise > 0)) return json({ error: 'That package is no longer available.' }, 400);
      const order = await newOrder(pkg.pricePaise, {
        kind: 'package', package_id: item.packageId, service_id: item.serviceId, staff_id: body.staff_id,
        start, hold_token: clip(body.hold_token), customer_notes: clip(body.notes)
      }, pkg.name);
      return orderReply(order, pkg.name);
    }

    // A single session: Waky keeps the time for 10 minutes while the client pays.
    let r;
    if (body.resume_booking_id && UUID.test(String(body.resume_booking_id))) {
      const token = await manageTokenFor(env, s.phone, body.resume_booking_id);
      if (!token) return json({ error: 'We could not find that booking for your number.' }, 404);
      if (body.hold_token) await waky(env, 'DELETE', '/slot-holds/' + encodeURIComponent(body.hold_token)).catch(() => {});
      r = await waky(env, 'POST', '/bookings/' + body.resume_booking_id + '/resume', { body: { start, staffId: body.staff_id }, manageToken: token });
      if (r.ok) r = { ...r, data: { booking: r.data } };
    } else {
      r = await waky(env, 'POST', '/bookings', {
        idem: String(body.attempt_key || crypto.randomUUID()),
        body: {
          serviceId: item.serviceId,
          staffId: body.staff_id,
          start,
          holdToken: body.hold_token || undefined,
          client: { name: String(body.name).slice(0, 120), phone: s.phone, email: body.email || undefined, whatsappOptIn: true },
          notes: body.notes || undefined
        }
      });
    }
    if (!r.ok) {
      return conflict(r)
        ? json({ error: 'That time was just booked by someone else. Please pick another time.', slot_conflict: true }, 409)
        : json({ error: wakyMessage(r, 'Could not start the booking.') }, 400);
    }
    const booking = r.data.booking;
    const pay = booking.payment || {};
    if (!(pay.amountPaise > 0) || pay.status === 'paid' || pay.status === 'not_required') {
      // Covered by the client's package or wallet, or free: nothing to pay.
      return json({ booked: true, booking_id: booking.id, reference: booking.reference });
    }
    const label = booking.serviceName || (c.byId[item.serviceId] && c.byId[item.serviceId].name) || 'Session';
    const order = await newOrder(pay.amountPaise, { kind: 'booking', waky_booking_id: booking.id }, label);
    return orderReply(order, label);
  }

  if (['/api/payment/verify', '/api/payment/ccd-verify'].includes(path) && request.method === 'POST') {
    const body = await request.clone().json().catch(() => ({}));
    const orderId = String(body.razorpay_order_id || '').trim();
    const paymentId = String(body.razorpay_payment_id || '').trim();
    const signature = String(body.razorpay_signature || '').trim();
    if (!/^order_[A-Za-z0-9]+$/.test(orderId) || !/^pay_[A-Za-z0-9]+$/.test(paymentId) || !/^[0-9a-f]{64}$/.test(signature)) {
      return json({ error: 'Missing payment verification fields' }, 400);
    }
    const expected = await hmacSha256Hex(env.RAZORPAY_KEY_SECRET, orderId + '|' + paymentId);
    if (!constantTimeEqual(expected, signature)) return json({ success: false, error: 'Payment could not be verified.' }, 400);
    const [order, payment] = await Promise.all([
      razorpayRequest(env, 'GET', 'orders/' + orderId),
      razorpayRequest(env, 'GET', 'payments/' + paymentId)
    ]);
    if (!order.notes || order.notes.engine !== 'waky') return null; // an older Zoho-engine order
    if (path === '/api/payment/ccd-verify') {
      if (!UUID.test(String(body.booking_id || '')) || typeof body.collection_token !== 'string' || order.notes.waky_booking_id !== body.booking_id || order.notes.ccd_collection !== '1') return json({ error: 'Payment does not match this booking.' }, 400);
      const permitted = await waky(env, 'POST', '/bookings/' + body.booking_id + '/collection', { body: { token: body.collection_token } });
      if (!permitted.ok) return json({ error: 'This payment link is no longer valid. Your coordinator can check the payment.' }, 400);
    }

    let result;
    try {
      result = await finalizeWakyPayment(env, h, order, payment);
    } catch (err) {
      console.error('Waky finalize failed', paymentId, errorText(err));
      return json({ success: false, retry: true, error: 'Still confirming your booking…' }, 503);
    }
    if (result.status === 'booked') return json({ success: true, booking_id: result.bookingId, payment_id: paymentId });
    if (result.status === 'pending') return json({ success: false, retry: true, error: result.message }, 202);
    if (result.status === 'needs_rebook') {
      return json({
        success: false, needs_rebook: true, order_id: result.rebookId,
        error: 'Your payment was successful, but that time was just taken. Please choose a new date and time - you will not be charged again.'
      }, 409);
    }
    return json({ success: false, error: result.message || 'Payment not completed.' }, 400);
  }

  if (path === '/api/payment/abandon' && request.method === 'POST') {
    const { body, s } = await session();
    if (!s) return reverify();
    const orderId = String(body.order_id || '');
    if (!/^order_\w+$/.test(orderId)) return json({ error: 'order_id required' }, 400);
    const order = await razorpayRequest(env, 'GET', 'orders/' + orderId).catch(() => null);
    const notes = (order && order.notes) || {};
    if (!order || notes.engine !== 'waky') return null;
    if (notes.phone !== s.phone) return json({ error: 'Not found' }, 404);
    // A cancelled checkout needs nothing: Waky frees the time after 10 minutes and offers "resume".
    if (body.reason === 'failed' && notes.kind === 'booking') {
      const token = await manageTokenFor(env, s.phone, notes.waky_booking_id);
      if (token) {
        await waky(env, 'POST', '/bookings/' + notes.waky_booking_id + '/payment', {
          manageToken: token,
          body: { status: 'failed', amountPaise: Number(order.amount), razorpayOrderId: order.id, errorDescription: String(body.message || 'Payment failed').slice(0, 300) }
        }).catch(() => {});
      }
    }
    return json({ ok: true });
  }

  if (path === '/api/payment/webhook' && request.method === 'POST') {
    if (!env.RAZORPAY_WEBHOOK_SECRET) return null;
    const rawBody = await request.clone().text();
    const sig = await hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET, rawBody);
    if (!constantTimeEqual(sig, request.headers.get('X-Razorpay-Signature'))) return null;
    const event = JSON.parse(rawBody);
    const payment = event.payload && event.payload.payment && event.payload.payment.entity;
    if (!payment || !payment.order_id) return null;
    const order = await razorpayRequest(env, 'GET', 'orders/' + payment.order_id).catch(() => null);
    if (!order || !order.notes || order.notes.engine !== 'waky') return null; // Zoho-engine order: old handler
    if (['payment.captured', 'payment.authorized'].includes(event.event)) {
      const result = await finalizeWakyPayment(env, h, order, payment);
      console.log('Waky webhook finalize', payment.order_id, result.status);
      // Not finished (capture failed, or the booking app was unreachable): answer with an error so Razorpay sends it again.
      if (result.retry || result.status === 'error') return new Response('Retry later', { status: 503 });
    }
    return new Response('OK', { status: 200 });
  }

  // -- Paid but the time was given away: choose a new time --------------------
  if (path === '/api/payment/waiting' && request.method === 'POST') {
    const { s } = await session();
    if (!s) return reverify();
    const items = (await bookingsForPhone(env, s.phone, 'pending')).filter((b) => b.payment && b.payment.action === 'choose_new_time');
    return json({
      waiting: items.map((b) => ({
        order_id: 'wb_' + b.id,
        service_id: b.serviceId,
        service_name: b.serviceName,
        staff_id: b.staffId,
        staff_name: b.staffName,
        amount: (Number(b.payment.amountPaise) || 0) / 100,
        currency: 'INR'
      }))
    });
  }

  if (path === '/api/payment/rebook' && request.method === 'POST') {
    const { body, s } = await session();
    if (!s) return reverify();
    const start = istToIso(body.date, body.time);
    if (!start) return json({ error: 'date and time are required' }, 400);
    if (body.hold_token) await waky(env, 'DELETE', '/slot-holds/' + encodeURIComponent(body.hold_token)).catch(() => {});

    const wb = WAKY_BOOKING_REF.exec(String(body.order_id || ''));
    if (wb) {
      // A paid Waky booking whose time was given away: move it to the new time.
      const token = await manageTokenFor(env, s.phone, wb[1]);
      if (!token) return json({ error: 'We could not find that booking for your number.' }, 404);
      const r = await waky(env, 'POST', '/bookings/' + wb[1] + '/resume', { body: { start, staffId: body.staff_id || undefined }, manageToken: token });
      if (r.ok) return json({ success: true, booking_id: wb[1] });
      return conflict(r)
        ? json({ error: 'That time was just taken. Please choose another time.', slot_conflict: true }, 409)
        : json({ error: wakyMessage(r, 'Could not book that time.') }, 400);
    }

    // A package bought whose first time was taken: the credit is in Waky, so book with it.
    const orderId = String(body.order_id || '');
    if (!/^order_\w+$/.test(orderId)) return json({ error: 'order_id required' }, 400);
    const order = await razorpayRequest(env, 'GET', 'orders/' + orderId).catch(() => null);
    const notes = (order && order.notes) || {};
    if (!order || notes.engine !== 'waky') return null;
    if (notes.phone !== s.phone || order.status !== 'paid') return json({ error: 'We could not find that payment for your number.' }, 404);
    const r = await waky(env, 'POST', '/bookings', {
      idem: 'rebook-' + orderId + '-' + start,
      body: {
        serviceId: notes.service_id,
        staffId: notes.staff_id || undefined,
        start,
        client: { name: notes.name, phone: s.phone, email: notes.email || undefined, whatsappOptIn: true },
        notes: notes.customer_notes || undefined
      }
    });
    if (r.ok) return json({ success: true, booking_id: r.data.booking.id });
    return conflict(r)
      ? json({ error: 'That time was just taken. Please choose another time.', slot_conflict: true }, 409)
      : json({ error: wakyMessage(r, 'Could not book that time.') }, 400);
  }

  // -- "My bookings" and the home page "Resume your booking" card -------------
  if (path === '/api/sessions' && request.method === 'POST') {
    const { s } = await session();
    if (!s) return reverify();
    const lists = await Promise.all([bookingsForPhone(env, s.phone, 'upcoming', true), bookingsForPhone(env, s.phone, 'past', true)]).catch(() => null);
    if (!lists) return json({ error: 'Could not load your sessions. Please try again shortly.' }, 503);
    // Payment attempts belong to recovery, not a client's confirmed session history.
    const confirmed = (b) => b.payment && b.payment.status === 'paid' && b.payment.action !== 'choose_new_time';
    const [upcoming, past] = lists.map(items => items.filter(confirmed));
    const map = (b) => {
      const t = isoToIst(b.start);
      const end = isoToIst(b.end);
      return {
        id: b.id,
        reference: b.reference,
        date: zohoDate(t.date),
        start_time: t.time24,
        end_time: end.time24,
        service_name: b.serviceName,
        therapist_name: b.staffName,
        session_mode: 'Video',
        booking_status: bookingLabel(b),
        payment_status: b.payment ? b.payment.status : null,
        amount: ((b.payment && Number(b.payment.amountPaise)) || 0) / 100
      };
    };
    return json({ customer: upcoming.length || past.length ? { name: null, phone: s.phone } : null, upcoming: upcoming.map(map), past: past.map(map) });
  }

  if (path === '/api/booking/resume' && request.method === 'POST') {
    const { s } = await session();
    if (!s) return reverify();
    const items = (await bookingsForPhone(env, s.phone, 'pending'))
      .filter((b) => b.payment && (b.payment.action === 'pay' || b.payment.action === 'resume'))
      .sort((a, b) => Date.parse(b.payment.resumeUntil || 0) - Date.parse(a.payment.resumeUntil || 0));
    const b = items[0];
    if (!b) return json({ resume: null });
    const c = await catalog(env).catch(() => null);
    const svc = c && c.byId[b.serviceId];
    const t = isoToIst(b.start);
    return json({
      resume: {
        engine: 'waky',
        booking_id: b.id,
        order_id: 'wb_' + b.id,
        service_id: b.serviceId,
        service_name: b.serviceName,
        session_type: typeOf(b.serviceName),
        staff_id: b.staffId,
        staff_name: b.staffName,
        date: t.date,
        time: t.time12,
        amount: (Number(b.payment.amountPaise) || 0) / 100,
        currency: 'INR',
        duration: svc ? svc.durationMin : 60,
        name: '',
        email: '',
        notes: '',
        slot_available: Date.parse(b.start) > Date.now() + 15 * 60 * 1000,
        expires_at: Date.parse(b.payment.resumeUntil) || Date.now()
      }
    });
  }

  return null;
}
