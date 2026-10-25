import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = await readFile(new URL('../../worker/src/waky.js', import.meta.url), 'utf8');
const { finalizeWakyPayment, handleWaky } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const env = { WAKY_API_URL: 'https://example.invalid', BOOKING_API_KEY: 'synthetic', RAZORPAY_WEBHOOK_SECRET: 'synthetic' };
const order = { id: 'order_test', amount: 100, notes: { engine: 'waky', kind: 'booking', phone: 'synthetic', waky_booking_id: 'synthetic-booking' } };
const payment = { id: 'pay_test', order_id: order.id, amount: 100, currency: 'INR', status: 'authorized' };

test('S3 capture and retry regression checks (synthetic only)', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  let writes;
  let unavailable = false;
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'POST') {
      writes.push(JSON.parse(options.body));
      return unavailable ? Response.json({ error: { message: 'unavailable' } }, { status: 503 }) : Response.json({ data: { booking: { id: 'synthetic-booking' } } });
    }
    return Response.json({ data: [{ id: 'synthetic-booking', manageToken: 'synthetic-token' }] });
  };
  console.error = () => {};
  const helpers = (capture) => ({ razorpayRequest: capture, errorText: () => 'synthetic failure' });
  try {
    for (const refetchFails of [false, true]) {
      await t.test(`failed capture never grants payment or package credit; refetch fails=${refetchFails}`, async () => {
        writes = [];
        const h = helpers(async (_env, method) => {
          if (method === 'POST' || refetchFails) throw new Error('unavailable');
          return payment;
        });
        for (const kind of ['booking', 'package']) {
          const result = await finalizeWakyPayment(env, h, { ...order, notes: { ...order.notes, kind } }, payment);
          assert.equal(result.status, 'pending');
          assert.equal(result.retry, true);
        }
        assert.deepEqual(writes, []);
      });
    }
    await t.test('concurrent capture is rechecked, then reported paid', async () => {
      writes = [];
      const result = await finalizeWakyPayment(env, helpers(async (_env, method) => {
        if (method === 'POST') throw new Error('already captured');
        return { ...payment, status: 'captured' };
      }), order, payment);
      assert.equal(result.status, 'booked');
      assert.equal(writes[0].status, 'paid');
    });
    await t.test('successful capture and duplicate captured callbacks remain successful', async () => {
      writes = [];
      const h = helpers(async () => ({ ...payment, status: 'captured' }));
      assert.equal((await finalizeWakyPayment(env, h, order, payment)).status, 'booked');
      assert.equal((await finalizeWakyPayment(env, helpers(async () => { throw new Error('must not capture twice'); }), order, { ...payment, status: 'captured' })).status, 'booked');
      assert.ok(writes.every((w) => w.status === 'paid'));
    });
    await t.test('webhook retries when capture or booking confirmation fails', async () => {
      for (const captureFails of [true, false]) {
        writes = [];
        unavailable = !captureFails;
        const h = {
          ...helpers(async (_env, _method, path) => {
            if (path.startsWith('orders/')) return order;
            throw new Error('unavailable');
          }),
          hmacSha256Hex: async () => 'synthetic-signature',
          constantTimeEqual: (a, b) => a === b,
        };
        const req = new Request('https://example.invalid/api/payment/webhook', { method: 'POST', headers: { 'X-Razorpay-Signature': 'synthetic-signature' }, body: JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { ...payment, status: captureFails ? 'authorized' : 'captured' } } } }) });
        assert.equal((await handleWaky(req, env, new URL(req.url), {}, h)).status, 503);
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});
