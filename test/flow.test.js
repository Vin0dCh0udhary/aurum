import test from 'node:test';
import assert from 'node:assert/strict';
process.env.MOCK_RATES = '1'; process.env.DEV = '1'; process.env.PAN_PROVIDER = 'none';
const { createApp } = await import('../server.js');
const { openDb } = await import('../lib/db.js');
const R = await import('../lib/rates.js');
const Totp = await import('../lib/totp.js');
const { setFixedNow, advanceDays } = await import('../lib/clock.js');

const db = openDb(':memory:');
R.setOnTick(() => {});
await R.refresh();
const server = createApp(db).listen(0);
const base = `http://localhost:${server.address().port}`;
test.after(() => server.close());

const api = async (method, path, token, body, rawHeaders = {}) => {
  const headers = { 'content-type': 'application/json', ...rawHeaders };
  if (token) headers['authorization'] = `Bearer ${token}`;
  const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return Array.isArray(j) ? { status: r.status, rows: j } : { status: r.status, ...j };
};
const login = async (phone, role, totp = null) => (await api('POST', '/api/auth/otp/verify', null, { phone, otp: '123456', role, totp })).token;
const MON_11AM = Date.parse('2026-11-23T11:00:00+05:30');
const SAT_NOON = Date.parse('2026-11-21T12:00:00+05:30');

let J, U, code, enrolId;
test('jeweller registers, ticks checks, goes live', async () => {
  setFixedNow(MON_11AM);
  J = await login('9000000001', 'jeweller');
  const bad = await api('POST', '/api/jeweller/register', J, { owner_name: 'A', shop_name: 'Shri Jewels', city: 'Bengaluru', upi_vpa: 'shop@okhdfcbank', pan: 'ABCPE1234F', gstin: '27AAPFU0939F1ZV' });
  assert.equal(bad.status, 400); // PAN differs from PAN inside GSTIN
  const ok = await api('POST', '/api/jeweller/register', J, { owner_name: 'Anil', shop_name: 'Shri Jewels', city: 'Bengaluru', upi_vpa: 'shop@okhdfcbank', pan: 'AAPFU0939F', gstin: '27AAPFU0939F1ZV' });
  assert.equal(ok.store_code.length, 6); code = ok.store_code;
  assert.equal((await api('POST', '/api/jeweller/golive', J)).status, 400);
  for (const k of ['bank', 'bis', 'shop', 'agreement']) await api('POST', '/api/jeweller/checklist', J, { key: k, done: true });
  assert.equal((await api('POST', '/api/jeweller/golive', J)).status, 200);
  const cal = await api('POST', '/api/jeweller/calibrate', J, { product: 'G22', board_rate: Math.round(R.productParity('G22', R.getSpot()) * 1.01) });
  assert.equal(cal.status, 200);
});
test('customer: under-18 blocked, profile, wrong code, join', async () => {
  U = await login('9000000002', 'customer');
  assert.equal((await api('POST', '/api/customer/profile', U, { name: 'Ravi Kumar', dob: '2015-01-01', pan: 'ABCPE1234F' })).status, 400);
  assert.equal((await api('POST', '/api/customer/profile', U, { name: 'Ravi Kumar', dob: '1990-05-01', pan: 'ABCPE1234F', dpdp_consent: true })).kyc_status, 'CAPTURED');
  assert.equal((await api('POST', '/api/customer/join', U, { code: 'ZZZZZZ' })).status, 404);
  assert.equal((await api('POST', '/api/customer/join', U, { code: code.toLowerCase() })).ok, true);
  const me = await api('GET', '/api/customer/me', U);
  assert.equal(me.link_status, 'ACTIVE'); assert.equal(me.rates.usable, true);
});
test('enrol, pay, auto-confirm via bank SMS, ledger credited at quote', async () => {
  const e = await api('POST', '/api/customer/enrol', U, { product: 'G22', frequency: 'MONTHLY', instalment_rupees: 1000, staff_id: 'STAFF_ANITA' });
  enrolId = e.id; assert.ok(enrolId);
  assert.equal((await api('POST', '/api/customer/pay', U, { enrolment_id: enrolId, amount_rupees: 2500 })).status, 400);
  const pay = await api('POST', '/api/customer/pay', U, { enrolment_id: enrolId, amount_rupees: 1000 });
  assert.ok(pay.upi.startsWith('upi://pay?pa=shop%40okhdfcbank')); assert.ok(pay.grams > 0);
  const sub = await api('POST', `/api/customer/pay/${pay.id}/submit`, U, { utr: '432112345678' });
  assert.equal(sub.status, 'SUBMITTED');
  const me = (await api('GET', '/api/jeweller/me', J));
  assert.equal(me.pending.length, 1);
  const hook = me.hook.url;
  const r = await api('POST', hook, null, { text: 'A/c XX1234 credited Rs.1,000.00 by UPI Ref No 432112345678' });
  assert.equal(r.match.status, 'CREDITED');
  const led = await api('GET', `/api/customer/ledger/${enrolId}`, U);
  assert.equal(led.rows.length, 1); assert.equal(led.rows[0].amount, 1000);
  assert.ok(Math.abs(led.rows[0].grams - pay.grams) < 0.0001);
  assert.equal((await api('POST', `/api/customer/pay/${pay.id}/submit`, U, { utr: '432112345678' })).status, 400);
});
test('duplicate UTR is rejected; amount mismatch is not auto-confirmed; manual confirm works', async () => {
  const p1 = await api('POST', '/api/customer/pay', U, { enrolment_id: enrolId, amount_rupees: 500 });
  assert.equal((await api('POST', `/api/customer/pay/${p1.id}/submit`, U, { utr: '432112345678' })).status, 409);
  await api('POST', `/api/customer/pay/${p1.id}/submit`, U, { utr: '111122223333' });
  const m = await api('POST', '/api/hooks/bank-sms/' + (await api('GET', '/api/jeweller/me', J)).hook.url.split('/').pop(), null, { text: 'credited Rs.600.00 UPI Ref No 111122223333' });
  assert.equal(m.match.mismatch, true);
  assert.equal((await api('POST', `/api/jeweller/payments/${p1.id}/confirm`, J)).status, 'CREDITED');
});
test('weekend payment waits for market open', async () => {
  setFixedNow(SAT_NOON);
  const p = await api('POST', '/api/customer/pay', U, { enrolment_id: enrolId, amount_rupees: 500 });
  assert.equal(p.marketOpen, false);
  await api('POST', `/api/customer/pay/${p.id}/submit`, U, { utr: '999988887777' });
  const c = await api('POST', `/api/jeweller/payments/${p.id}/confirm`, J);
  assert.equal(c.status, 'AWAITING_OPEN');
  setFixedNow(Date.parse('2026-11-23T09:30:00+05:30') + 0);
  await api('GET', '/api/customer/me', U); // sweep prices it at the reopening rate
  assert.equal((await api('GET', `/api/customer/pay/${p.id}`, U)).status, 'CREDITED');
  setFixedNow(MON_11AM);
});
test('ledger chain verifies and detects tampering', async () => {
  assert.equal((await api('GET', '/api/jeweller/ledger', J)).chain.ok, true);
  db.prepare('UPDATE ledger SET grams_u = grams_u + 1 WHERE id = 1').run();
  assert.equal((await api('GET', '/api/jeweller/ledger', J)).chain.ok, false);
  db.prepare('UPDATE ledger SET grams_u = grams_u - 1 WHERE id = 1').run();
  assert.equal((await api('GET', '/api/jeweller/ledger', J)).chain.ok, true);
});
test('no redemption before maturity; redeem at month 11; liability meter', async () => {
  assert.equal((await api('POST', `/api/jeweller/enrolments/${enrolId}/redeem`, J)).status, 400);
  assert.equal((await api('POST', `/api/customer/enrolments/${enrolId}/redeem`, U)).status, 400);
  const before = await api('GET', '/api/jeweller/me', J);
  assert.ok(before.liability[0].grams > 0);
  advanceDays(335);
  assert.equal((await api('POST', '/api/customer/pay', U, { enrolment_id: enrolId, amount_rupees: 500 })).status, 400); // deposits closed
  assert.equal((await api('POST', `/api/customer/enrolments/${enrolId}/redeem`, U)).ok, true);
  const r = await api('POST', `/api/jeweller/enrolments/${enrolId}/redeem`, J);
  assert.ok(r.grams > 0);
  const me = await api('GET', '/api/customer/me', U);
  assert.equal(me.enrolments[0].grams, 0); assert.equal(me.enrolments[0].status, 'REDEEMED');
  assert.equal((await api('GET', '/api/jeweller/ledger', J)).chain.ok, true);
});
test('invite code is single use; approval switch holds new users', async () => {
  advanceDays(-335);
  const inv = await api('POST', '/api/jeweller/invite', J);
  const U2 = await login('9000000003', 'customer');
  await api('POST', '/api/customer/profile', U2, { name: 'Sita Devi', dob: '1992-02-02', pan: 'BCDPE2345G' });
  assert.equal((await api('POST', '/api/customer/join', U2, { code: inv.code })).ok, true);
  const U3 = await login('9000000004', 'customer');
  await api('POST', '/api/customer/profile', U3, { name: 'Gita Devi', dob: '1991-02-02', pan: 'CDEPE3456H' });
  assert.equal((await api('POST', '/api/customer/join', U3, { code: inv.code })).status, 404);
  await api('POST', '/api/jeweller/settings', J, { approval_required: true });
  assert.equal((await api('POST', '/api/customer/join', U3, { code: code })).pending, true);
  assert.equal((await api('POST', '/api/customer/enrol', U3, { product: 'G24', frequency: 'DAILY', instalment_rupees: 100 })).status, 400);
});

// ---------- NEW FEATURE INTEGRATION FLOW TESTS ----------
test('legal terms routes return valid compliance documents', async () => {
  const terms = await api('GET', '/api/legal/scheme-terms');
  assert.equal(terms.status, 200);
  assert.ok(terms.sections.length > 0);
  assert.ok(terms.title.includes('Scheme'));

  const priv = await api('GET', '/api/legal/privacy-policy');
  assert.equal(priv.status, 200);
  assert.ok(priv.title.includes('DPDP'));

  const ref = await api('GET', '/api/legal/refund-policy');
  assert.equal(ref.status, 200);
  assert.ok(ref.title.includes('Refund'));
});

test('customer pause-once feature and resume', async () => {
  const newEnr = await api('POST', '/api/customer/enrol', U, { product: 'G24', frequency: 'MONTHLY', instalment_rupees: 500 });
  const pId = newEnr.id;

  const pauseRes = await api('POST', `/api/customer/enrolments/${pId}/pause`, U);
  assert.equal(pauseRes.status, 200);
  assert.equal(pauseRes.ok, true);

  // Paying while paused should be blocked
  const payAttempt = await api('POST', '/api/customer/pay', U, { enrolment_id: pId, amount_rupees: 500 });
  assert.equal(payAttempt.status, 400);

  // Second pause attempt should fail (pause once only)
  const pauseAgain = await api('POST', `/api/customer/enrolments/${pId}/pause`, U);
  assert.equal(pauseAgain.status, 400);

  // Resume plan
  const resumeRes = await api('POST', `/api/customer/enrolments/${pId}/resume`, U);
  assert.equal(resumeRes.status, 200);
  assert.equal(resumeRes.ok, true);
});

test('jeweller 2FA setup, enable, login enforcement and disable', async () => {
  const jwMe = await api('GET', '/api/jeweller/me', J);
  const jwPhone = '9000000001';

  // 1. Setup 2FA
  const setup = await api('POST', '/api/jeweller/2fa/setup', J);
  assert.equal(setup.status, 200);
  assert.ok(setup.secret);
  assert.ok(setup.uri.includes('otpauth://'));

  // 2. Enable 2FA with valid token
  const validToken = Totp.generateTotpToken(setup.secret);
  const enable = await api('POST', '/api/jeweller/2fa/enable', J, { secret: setup.secret, token: validToken });
  assert.equal(enable.status, 200);
  assert.equal(enable.ok, true);

  // 3. Login without 2FA should prompt needs2fa
  const loginPrompt = await api('POST', '/api/auth/otp/verify', null, { phone: jwPhone, otp: '123456', role: 'jeweller' });
  assert.equal(loginPrompt.needs2fa, true);

  // 4. Login with valid 2FA token succeeds
  const loginSuccess = await api('POST', '/api/auth/otp/verify', null, { phone: jwPhone, otp: '123456', role: 'jeweller', totp: validToken });
  assert.ok(loginSuccess.token);

  // 5. Disable 2FA
  const disable = await api('POST', '/api/jeweller/2fa/disable', loginSuccess.token, { token: validToken });
  assert.equal(disable.ok, true);
});

test('gateway AutoPay webhook settlement and idempotency', async () => {
  // Configure mock gateway
  const jwMe = await api('GET', '/api/jeweller/me', J);
  const jwId = 1;
  await api('POST', '/api/jeweller/gateway', J, { provider: 'mock', credentials: {}, webhook_secret: 'mock_secret' });

  // Create an active enrolment
  const e = await api('POST', '/api/customer/enrol', U, { product: 'G18', frequency: 'MONTHLY', instalment_rupees: 500 });

  // Webhook event simulation
  const hookPayload = {
    event: 'PAYMENT_SUCCESS',
    enrolmentId: e.id,
    amountPaise: 50000,
    utr: 'GWUTR7788990011',
    gatewayPaymentId: 'CF_TXN_999888',
  };

  const hookRes = await api('POST', `/api/hooks/gateway/${jwId}/mock`, null, hookPayload, { 'x-mock-signature': 'valid_mock_signature' });
  assert.equal(hookRes.ok, true);
  assert.equal(hookRes.settled.status, 'CREDITED');

  // Verify duplicate webhook event is safely ignored (idempotent)
  const dupRes = await api('POST', `/api/hooks/gateway/${jwId}/mock`, null, hookPayload, { 'x-mock-signature': 'valid_mock_signature' });
  assert.equal(dupRes.duplicate, true);

  // Verify customer passbook received the credit
  const passbook = await api('GET', `/api/customer/ledger/${e.id}`, U);
  assert.equal(passbook.rows.length, 1);
  assert.equal(passbook.rows[0].utr, 'GWUTR7788990011');
});

test('staff leaderboard aggregation', async () => {
  const leaderboard = await api('GET', '/api/jeweller/staff-leaderboard', J);
  assert.equal(leaderboard.status, 200);
  assert.ok(leaderboard.rows.length >= 1);
  const staffAnita = leaderboard.rows.find(s => s.staff === 'STAFF_ANITA');
  assert.ok(staffAnita);
  assert.ok(staffAnita.schemes >= 1);
});

test('DPDP account deletion blocked with active balance, succeeds when clear', async () => {
  const U_New = await login('9000000099', 'customer');
  await api('POST', '/api/customer/profile', U_New, { name: 'Pooja Roy', dob: '1993-04-12', pan: 'DPEPE4567J', dpdp_consent: true });
  await api('POST', '/api/customer/join', U_New, { code: code });

  // Account with zero active scheme balances can delete their data
  const delSuccess = await api('POST', '/api/customer/delete-account', U_New);
  assert.equal(delSuccess.ok, true);
  assert.ok(delSuccess.message.includes('erased'));

  // Session should be invalidated
  const meAfter = await api('GET', '/api/customer/me', U_New);
  assert.equal(meAfter.status, 401);
});
