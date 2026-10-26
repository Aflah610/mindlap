// OTP_PROVIDER=booking: the booking app owns codes and Meta delivery; Cloudflare owns the website session.
export async function handleBookingOtp(request, env, url, headers, helpers) {
  const sending = url.pathname === '/api/otp/send';
  if (env.OTP_PROVIDER !== 'booking' || request.method !== 'POST' || (!sending && url.pathname !== '/api/otp/verify')) return null;
  const reply = (data, status = 200) => helpers.jsonResponse(data, status, headers);
  const unavailable = () => reply({ success: false, error: 'Verification is temporarily unavailable. Please try again.' }, 503);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ success: false, error: 'Please send a valid verification request.' }, 400);
  const phone = helpers.parseE164(body.phone);
  const code = String(body.code || '').trim();
  if (!phone) return reply({ success: false, error: 'Please enter a valid phone number.' }, 400);
  if (!sending && !/^\d{6}$/.test(code)) return reply({ success: false, error: 'Please enter the 6-digit code.' }, 400);
  if (!env.BOOKING_OTP_API_KEY || !env.SESSION_TOKEN_SECRET || !env.SLOT_HOLDS) return unavailable();
  try {
    const rules = sending ? [
      { key: 'otp-send:' + phone, limit: 3, windowMs: 10 * 60 * 1000 },
      { key: 'otp-send-ip:' + helpers.clientIp(request), limit: 10, windowMs: 60 * 60 * 1000 }
    ] : [
      { key: 'otp-verify:' + phone, limit: 5, windowMs: 15 * 60 * 1000 },
      { key: 'otp-verify-ip:' + helpers.clientIp(request), limit: 30, windowMs: 60 * 60 * 1000 }
    ];
    for (const rule of rules) {
      const limit = await helpers.holdsCall(env, 'hit', rule);
      if (typeof limit?.ok !== 'boolean') return unavailable();
      if (!limit.ok) return reply({ success: false, error: 'Too many attempts. Please wait a few minutes and try again.' }, 429);
    }
    const endpoint = new URL(env.WAKY_API_URL);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) return unavailable();
    endpoint.pathname = '/api/v1/otp/' + (sending ? 'send' : 'verify');
    endpoint.search = ''; endpoint.hash = '';
    let reference;
    if (!sending) {
      const current = await helpers.holdsCall(env, 'otp-reference-get', { phone });
      reference = current?.reference;
      if (!reference) return reply({ success: false, error: 'Please request a new code first.' }, 400);
    }
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: 'Bearer ' + env.BOOKING_OTP_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(sending ? { phone } : { phone, reference, code })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (sending && [409, 429].includes(response.status)) {
        return reply({ success: false, error: 'A code was recently requested. Please wait before trying again.' }, 429);
      }
      if (!sending && response.status === 404) {
        await helpers.holdsCall(env, 'otp-reference-drop', { phone, reference });
        return reply({ success: false, error: 'Please request a new code first.' }, 400);
      }
      return unavailable();
    }
    const data = payload?.data;
    if (sending) {
      const expiresAt = Date.parse(data?.expiresAt);
      if (data?.phone !== phone || !/^OTP-REF-[A-Z0-9]{10,32}$/.test(data?.reference || '') ||
          !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 10 * 60 * 1000) return unavailable();
      const saved = await helpers.holdsCall(env, 'otp-reference-set', { phone, reference: data.reference, expiresAt });
      if (saved?.ok !== true) return reply({ success: false, error: 'Please use the most recently requested code.' }, 409);
      return reply({ success: true });
    }
    if (data?.phone !== phone || data?.reference !== reference || typeof data?.verified !== 'boolean') return unavailable();
    if (data.verified === true) {
      await helpers.holdsCall(env, 'otp-reference-drop', { phone, reference });
      const sessionToken = await helpers.createSessionToken(env, phone);
      return reply({ success: true, phone, session_token: sessionToken });
    }
    const messages = {
      incorrect_code: 'That code is incorrect. Please check it and try again.',
      expired: 'That code has expired. Please request a new one.',
      too_many_attempts: 'Too many incorrect attempts. Please request a new code.',
      already_used: 'That code has already been used. Please request a new one.',
      replaced: 'Please use the most recently requested code.',
      not_sent: 'The code was not delivered. Please request a new one.'
    };
    if (['expired', 'too_many_attempts', 'already_used', 'replaced', 'not_sent'].includes(data.reason)) {
      await helpers.holdsCall(env, 'otp-reference-drop', { phone, reference });
    }
    return reply({ success: false, error: messages[data.reason] || 'Verification failed. Please try again.' }, 400);
  } catch {
    // Never forward provider errors, codes, API keys or login details to logs or the browser.
    return unavailable();
  }
}
