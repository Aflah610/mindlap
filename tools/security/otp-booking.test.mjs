import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const dataModule = (s) => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
const otpUrl = dataModule(await readFile(new URL('../../worker/src/otp-booking.js', import.meta.url), 'utf8'));
const wakyUrl = dataModule(await readFile(new URL('../../worker/src/waky.js', import.meta.url), 'utf8'));
const source = (await readFile(new URL('../../worker/src/index.js', import.meta.url), 'utf8'))
  .replace("'./otp-booking.js'", JSON.stringify(otpUrl)).replace("'./waky.js'", JSON.stringify(wakyUrl));
const { default: worker, SlotHolds } = await import(dataModule(source));
const phone = '+910000000000';
const reference = 'OTP-REF-AAAAAAAAAA';
const second = 'OTP-REF-BBBBBBBBBB';
const origin = 'https://mindlap.in';

function setup() {
  const values = new Map();
  const actor = new SlotHolds({ storage: {
    get: async (key) => structuredClone(values.get(key)),
    put: async (key, value) => { values.set(key, structuredClone(value)); },
    delete: async (key) => values.delete(key),
  } });
  const env = { OTP_PROVIDER: 'booking', BOOKING_ENGINE: 'waky', WAKY_API_URL: 'https://book.example.invalid',
    BOOKING_OTP_API_KEY: 'synthetic-otp-key', SESSION_TOKEN_SECRET: 'synthetic-session-key', ALLOWED_ORIGIN: origin,
    ZOHO_CREATOR_SEND_OTP_URL: 'https://creator.example.invalid/send', ZOHO_CREATOR_VERIFY_OTP_URL: 'https://creator.example.invalid/verify',
    SLOT_HOLDS: { idFromName: () => 'global', get: () => ({ fetch: (url, init) => actor.fetch(new Request(url, init)) }) },
  };
  const call = async (action, body, override = {}) => worker.fetch(new Request('https://worker.example.invalid/api/otp/' + action, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.10' }, body: JSON.stringify(body)
  }), { ...env, ...override });
  const op = async (name, body) => (await actor.fetch(new Request('https://internal/' + name, { method: 'POST', body: JSON.stringify(body) }))).json();
  return { values, env, call, op };
}

const sent = () => Response.json({ data: { phone, reference, expiresAt: new Date(Date.now() + 300_000).toISOString(), expiresInSec: 300 } }, { status: 201 });

test('OTP migration: routing, session compatibility and failure controls (synthetic only)', async (t) => {
  const originalFetch = globalThis.fetch;
  try {
    await t.test('send and verify use booking-app only, retain the browser contract, and issue a valid 24-hour session once', async () => {
      const { call, values } = setup(); let requests = [];
      globalThis.fetch = async (url, options) => {
        requests.push(String(url));
        assert.equal(options.headers.Authorization, 'Bearer synthetic-otp-key');
        assert.equal(options.redirect, 'error');
        const body = JSON.parse(options.body);
        if (String(url).endsWith('/send')) { assert.deepEqual(body, { phone }); return sent(); }
        assert.deepEqual(body, { phone, reference, code: '123456' });
        return Response.json({ data: { verified: true, phone, reference } });
      };
      const send = await call('send', { phone }); assert.equal(send.status, 200);
      assert.deepEqual(await send.json(), { success: true });
      const saved = values.get('otp-reference:' + phone);
      assert.deepEqual(Object.keys(saved).sort(), ['expiresAt', 'reference']);
      const verify = await call('verify', { phone, code: '123456' }); assert.equal(verify.status, 200);
      const result = await verify.json(); assert.equal(result.success, true); assert.equal(result.phone, phone);
      const [encoded, signature] = result.session_token.split('.');
      const payload = JSON.parse(Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
      assert.equal(payload.phone, phone); assert.ok(Math.abs(payload.exp - Date.now() - 86_400_000) < 5000);
      assert.equal(signature, createHmac('sha256', 'synthetic-session-key').update(encoded).digest('hex'));
      assert.equal((await call('verify', { phone, code: '123456' })).status, 400);
      assert.equal(requests.length, 2); assert.ok(requests.every(u => u.startsWith('https://book.example.invalid/api/v1/otp/')));
    });
    await t.test('backend timeouts, invalid credentials, delivery failure and invalid JSON never fall back to Creator', async () => {
      for (const status of [401, 403, 500, 502, 503]) {
        const { call } = setup(); let requests = 0;
        globalThis.fetch = async () => { requests++; return Response.json({ error: { message: 'sensitive provider data' } }, { status }); };
        const res = await call('send', { phone }); assert.equal(res.status, 503);
        assert.ok(!(await res.text()).includes('sensitive')); assert.equal(requests, 1);
      }
      for (const response of [() => { throw new Error('timeout'); }, () => new Response('not json')]) {
        const { call } = setup(); globalThis.fetch = response;
        assert.equal((await call('send', { phone })).status, 503);
      }
    });
    await t.test('missing settings or storage failure fail closed before sending', async () => {
      const { call } = setup(); let requests = 0;
      globalThis.fetch = async () => { requests++; return sent(); };
      for (const settings of [{ BOOKING_OTP_API_KEY: '' }, { SESSION_TOKEN_SECRET: '' }, { SLOT_HOLDS: null },
        { SLOT_HOLDS: { idFromName: () => 'global', get: () => ({ fetch: async () => { throw new Error('unavailable'); } }) } }]) {
        assert.equal((await call('send', { phone }, settings)).status, 503);
      }
      assert.equal(requests, 0);
    });
    await t.test('wrong phone, wrong reference, false verification or truthy strings cannot issue a session', async () => {
      for (const fields of [{ phone: '+911111111111' }, { reference: second }, { verified: false, reason: 'incorrect_code' }, { verified: 'true' }]) {
        const { call } = setup(); globalThis.fetch = async () => sent();
        await call('send', { phone });
        globalThis.fetch = async () => Response.json({ data: { verified: true, phone, reference, ...fields } });
        const res = await call('verify', { phone, code: '123456' });
        const body = await res.json(); assert.equal(body.success, false); assert.equal(body.session_token, undefined);
      }
    });
    await t.test('send limits and malformed codes are enforced without extra provider calls', async () => {
      const { call } = setup(); let requests = 0;
      globalThis.fetch = async () => { requests++; return sent(); };
      for (let i = 0; i < 3; i++) await call('send', { phone });
      assert.equal((await call('send', { phone })).status, 429); assert.equal(requests, 3);
      assert.equal((await call('verify', { phone, code: '12ab56' })).status, 400); assert.equal(requests, 3);
      assert.equal((await call('send', null)).status, 400); assert.equal(requests, 3);
    });
    await t.test('older send replies and old verification cleanup cannot replace or erase a newer reference', async () => {
      const { op, values } = setup(); const expiry = Date.now() + 300_000;
      assert.equal((await op('otp-reference-set', { phone, reference, expiresAt: expiry })).ok, true);
      assert.equal((await op('otp-reference-set', { phone, reference: second, expiresAt: expiry + 1000 })).ok, true);
      assert.equal((await op('otp-reference-set', { phone, reference, expiresAt: expiry })).ok, false);
      await op('otp-reference-drop', { phone, reference });
      assert.equal((await op('otp-reference-get', { phone })).reference, second);
      values.set('otp-reference:' + phone, { reference: second, expiresAt: Date.now() - 1 });
      assert.equal((await op('otp-reference-get', { phone })).reference, null);
    });
  } finally { globalThis.fetch = originalFetch; }
});
