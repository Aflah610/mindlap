// Offline security-review probes. Uses synthetic data and no database or credentials.
// Run: node tools/security/review-checks.cjs <booking-app-folder>
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(process.argv[2]);
const ts = require(path.join(root, 'node_modules/typescript'));
const realRequire = require('node:module').createRequire(path.join(root, 'package.json'));
function load(file, mocks = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('require', 'exports', js)((id) => id in mocks ? mocks[id] : realRequire(id), exports);
  return exports;
}
async function main() {
  const permissions = load('src/features/access/permissions.ts');
  class DomainError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const forms = {
    str: (f, k) => String(f.get(k) ?? '').trim(),
    act: async (_path, _message, callback) => callback(),
    optional: () => undefined,
  };
  const common = {
    'next/navigation': { redirect: () => { throw new Error('redirect'); } },
    'next/cache': { revalidatePath() {} },
    '@/features/access/permissions': permissions,
    '@/features/shared/errors': { DomainError },
    '@/lib/form-actions': forms,
  };
  const manager = { id: 'manager', role: 'manager', accessRole: 'manager' };
  let updated;
  const admin = load('src/app/admin/actions.ts', {
    ...common,
    '@/features/staff/staff.dto': { DESIGNATIONS: [] },
    '@/features/catalog/questions': {}, '@/lib/hours-form': {}, '@/lib/time': {}, '@/lib/format': {},
    '@/lib/session': { requirePermission: async () => manager, hasRole: (m, role) => m.role === role },
    '@/features/container': { app: () => ({ staff: {
      get: async () => ({ id: 'admin', accessRole: 'admin' }),
      update: async (_actor, _id, input) => { updated = input; },
      setServices: async () => {}, setServicePrices: async () => {},
    } }) },
  });
  const form = new FormData();
  for (const [k, v] of Object.entries({ name: 'Synthetic Admin', email: 'controlled@example.invalid', accessRole: 'admin', active: 'on', timezone: 'Asia/Kolkata' })) form.set(k, v);
  await admin.updateStaffAction('admin', form);
  assert.equal(updated.email, 'controlled@example.invalid');
  console.log('CONFIRMED: manager action accepts changing an existing admin login email');

  const clinician = { id: 'psychologist', role: 'staff', accessRole: 'psychologist' };
  let cancelled = false;
  const bookingActions = load('src/app/admin/bookings/actions.ts', {
    ...common,
    '@/lib/session': { requireStaff: async () => clinician, isFrontDesk: () => false,
      requirePermission: async () => { throw new Error('Permission denied'); } },
    '@/features/container': { app: () => ({ bookings: {
      get: async () => ({ staffId: clinician.id }), cancel: async () => { cancelled = true; },
    } }) },
  });
  await bookingActions.cancelBookingAction('synthetic-booking', new FormData());
  assert.equal(cancelled, true);
  console.log('CONFIRMED: psychologist cancellation reaches service without bookings.create permission');

  const caseModule = load('src/features/case-history/case-history.service.ts', {
    ...common, '@/features/shared/db-errors': {}, '@/features/shared/validation': {},
    '@/features/workflows/workflows.dto': {}, '@/lib/format': {},
    './case-history.dto': {}, './case-history.schemas': {}, './choices': {},
  });
  const cases = caseModule.createCaseHistoryService({ caseRepo: { currentTherapistId: async () => clinician.id } });
  assert.equal(await cases.canRead({ ...clinician, clinicalAdmin: false, permissions: new Set() }, 'synthetic-client'), true);
  console.log('CONFIRMED: assigned therapist retains clinical read access with an empty permission set');

  const search = load('src/app/api/admin/clients/search/route.ts', {
    '@/lib/session': { currentStaff: async () => ({ ...manager, permissions: new Set(['bookings.all']) }), isFrontDesk: () => true },
    '@/features/container': { app: () => ({ clients: { list: async () => [{ id: 'synthetic-client', name: 'Synthetic Client', phoneE164: '+910000000000', email: 'client@example.invalid' }] } }) },
  });
  const searchResponse = await search.GET(new Request('https://example.invalid/api/admin/clients/search?q=Synthetic'));
  const searchData = await searchResponse.json();
  assert.equal(searchData.data[0].phone, '+910000000000');
  console.log('CONFIRMED: client search returns contact fields without clients.contact permission');

  const dto = load('src/features/workflows/workflows.dto.ts');
  const schema = load('src/features/workflows/workflows.schemas.ts', {
    './workflows.dto': dto, './templates': { unknownPlaceholders: () => [] },
  });
  schema.workflowInput.parse({ name: 'Synthetic check', trigger: 'booked', action: { channel: 'webhook', url: 'http://127.0.0.1:3000/internal' } });
  console.log('CONFIRMED: production-independent workflow validation accepts loopback HTTP targets');

  const worker = fs.readFileSync(path.resolve(__dirname, '../../worker/src/waky.js'), 'utf8');
  const { finalizeWakyPayment } = await import('data:text/javascript;base64,' + Buffer.from(worker).toString('base64'));
  const originalFetch = global.fetch;
  let paidReported = false;
  global.fetch = async (_url, options) => {
    if (options.method === 'POST') {
      paidReported = JSON.parse(options.body).status === 'paid';
      return Response.json({ data: {} });
    }
    return Response.json({ data: [{ id: 'synthetic-booking', manageToken: 'synthetic-token' }] });
  };
  try {
    const result = await finalizeWakyPayment({ WAKY_API_URL: 'https://example.invalid', BOOKING_API_KEY: 'synthetic' }, {
      razorpayRequest: async () => { throw new Error('Synthetic capture failure'); }, errorText: () => 'synthetic failure',
    }, { id: 'order_synthetic', amount: 100, notes: { kind: 'booking', phone: 'synthetic', waky_booking_id: 'synthetic-booking' } },
    { id: 'pay_synthetic', order_id: 'order_synthetic', amount: 100, currency: 'INR', status: 'authorized' });
    assert.equal(paidReported, true);
    assert.equal(result.status, 'booked');
    console.log('CONFIRMED: failed capture still produces paid report and booked result');
  } finally { global.fetch = originalFetch; }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
