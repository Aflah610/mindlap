import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../../worker/src/waky.js', import.meta.url), 'utf8');
const { handleWaky } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const env = { WAKY_API_URL: 'https://example.invalid', BOOKING_API_KEY: 'synthetic' };
const booking = (id, status, payment, action = 'none') => ({ id, reference: id, start: '2026-10-29T03:30:00Z', end: '2026-10-29T04:30:00Z', status, staffName: 'Synthetic therapist', serviceName: 'Individual therapy', payment: payment === null ? null : { status: payment, amountPaise: 100000, action } });
const fixtures = [booking('paid', 'upcoming', 'paid'), booking('free', 'upcoming', 'not_required'), { ...booking('prepaid', 'upcoming', 'paid'), payment: { status: 'paid', action: 'none', amountPaise: 0, credit: { credits: 1 } } }, booking('pending', 'upcoming', 'pending'), booking('failed', 'upcoming', 'failed'), booking('missing', 'upcoming', null), booking('lost-time', 'upcoming', 'paid', 'choose_new_time')];
const request = () => new Request('https://example.invalid/api/sessions', { method: 'POST', body: JSON.stringify({ session_token: 'synthetic' }) });
const helpers = { verifySessionToken: async () => ({ phone: 'synthetic' }), jsonResponse: (data, status) => Response.json(data, { status }) };

test('account API keeps only confirmed paid/prepaid sessions and fails closed on upstream errors', async () => {
    const previous = globalThis.fetch;
    try {
        globalThis.fetch = async url => Response.json({ data: new URL(url).searchParams.get('view') === 'past' ? [booking('completed', 'completed', 'paid'), booking('past-failed', 'completed', 'failed')] : fixtures });
        const response = await handleWaky(request(), env, new URL('https://example.invalid/api/sessions'), {}, helpers);
        const data = await response.json();
        assert.deepEqual(data.upcoming.map(item => item.id), ['paid', 'prepaid']);
        assert.deepEqual(data.past.map(item => item.id), ['completed']);
        globalThis.fetch = async () => Response.json({ data: fixtures.filter(item => ['failed', 'pending'].includes(item.id)) });
        const empty = await (await handleWaky(request(), env, new URL('https://example.invalid/api/sessions'), {}, helpers)).json();
        assert.deepEqual(empty, { customer: null, upcoming: [], past: [] });
        globalThis.fetch = async () => Response.json({ error: 'unavailable' }, { status: 503 });
        assert.equal((await handleWaky(request(), env, new URL('https://example.invalid/api/sessions'), {}, helpers)).status, 503);
        globalThis.fetch = async () => { throw new Error('unauthorised request must not query bookings'); };
        assert.equal((await handleWaky(request(), env, new URL('https://example.invalid/api/sessions'), {}, { ...helpers, verifySessionToken: async () => null })).status, 401);
    } finally { globalThis.fetch = previous; }
});

const browserSource = (await readFile(new URL('../../book/book.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const accountFunctions = browserSource.slice(browserSource.indexOf('    function confirmedAccountSession('), browserSource.indexOf('    /**\n     * After logging in:'));
test('cached failed sessions cannot create an account, valid credits can, and outages do not mean a new client', async () => {
    let sessions = { upcoming: [{ booking_status: 'Payment failed', payment_status: 'failed' }, { booking_status: 'Payment pending', payment_status: 'pending' }], past: [] };
    let credits = { has_credits: false, credits: 0, wallet_credit: 0 };
    let unavailable = false;
    let creditsUnavailable = false;
    const functions = vm.runInNewContext(accountFunctions + ';({loadAccount, confirmedAccountSession})', {
        handleAuthError: () => false,
        post: async path => path === '/api/sessions' ? { res: { ok: !unavailable }, data: sessions } : { res: { ok: !creditsUnavailable }, data: credits }
    });
    const failedOnly = await functions.loadAccount('synthetic');
    assert.equal(failedOnly.hasAccount, false);
    assert.equal(failedOnly.data.upcoming.length, 0);
    sessions.upcoming.push({ booking_status: 'Confirmed', payment_status: 'Paid' });
    assert.equal((await functions.loadAccount('synthetic')).hasAccount, true);
    sessions = { upcoming: [], past: [{ booking_status: 'Completed', payment_status: 'Prepaid' }] };
    assert.equal((await functions.loadAccount('synthetic')).hasAccount, true);
    sessions = { upcoming: [], past: [] };
    credits = { has_credits: true, credits: 3, wallet_credit: 0 };
    assert.equal((await functions.loadAccount('synthetic')).hasAccount, true);
    unavailable = true;
    assert.equal((await functions.loadAccount('synthetic')).known, false);
    assert.equal(functions.confirmedAccountSession({ booking_status: 'Payment failed', payment_status: 'paid' }), false);
    assert.equal(functions.confirmedAccountSession({ booking_status: 'Confirmed', payment_status: 'not_required' }), false);
    unavailable = false; creditsUnavailable = true;
    sessions = { upcoming: [{ booking_status: 'Confirmed', payment_status: 'Paid' }], past: [] };
    const balanceOutage = await functions.loadAccount('synthetic');
    assert.equal(balanceOutage.hasAccount, true);
    assert.equal(balanceOutage.creditsKnown, false);
    assert.equal(balanceOutage.known, false);
});
