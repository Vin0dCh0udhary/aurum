import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../lib/rates.js';
import * as K from '../lib/kyc.js';
import * as S from '../lib/schemes.js';
import * as WA from '../lib/whatsapp.js';
import * as Totp from '../lib/totp.js';
import * as Gateway from '../lib/gateway.js';
import * as Legal from '../lib/legal.js';
import { addMonths } from '../lib/clock.js';
import { marketOpen } from '../lib/market.js';
import { parseCreditSms } from '../lib/ledger.js';

const spot = { xau: 4300, xag: 52, usdinr: 88 };
test('parity formula and purities', () => {
  const g24 = R.productParity('G24', spot);
  assert.ok(Math.abs(g24 - (4300 / 31.1035) * 88 * 1.15) < 1e-6);
  assert.ok(Math.abs(R.productParity('G22', spot) - g24 * 0.916) < 1e-6);
  assert.ok(Math.abs(R.productParity('G18', spot) - g24 * 0.75) < 1e-6);
  assert.ok(R.productParity('S999', spot) > 0);
});
test('customer rate includes 3% GST, composition does not', () => {
  const jw = { calib_gold: 0, calib_silver: 0, spread_bps: 100, gst_mode: 'REGULAR' };
  const a = R.customerRate('G24', spot, jw);
  assert.ok(Math.abs(a.inclPaise / a.basePaise - 1.03) < 0.0001);
  const b = R.customerRate('G24', spot, { ...jw, gst_mode: 'COMPOSITION' });
  assert.equal(b.inclPaise, b.basePaise);
});
test('grams are floored in integer units and never exceed what was paid', () => {
  const incl = 1500000; // Rs 15,000/g
  const u = R.gramsUnits(150000, incl); // Rs 1,500
  assert.equal(u, 1000); // 0.1000 g
  assert.ok((u * incl) / 10000 <= 150000);
});
test('calibration: implied factor reproduces board rate and band rejects typos', () => {
  const f = R.impliedFactor(13000, 'G22', spot, 0);
  assert.ok(Math.abs(R.productParity('G22', spot) * (1 + f) - 13000) < 1e-6);
  assert.equal(R.checkCalibration(f, f), null);
  assert.ok(R.checkCalibration(0, 0.05));
  assert.ok(R.checkCalibration(0, 0.2));
});
test('PAN and GSTIN validation', () => {
  assert.ok(K.panValid('ABCPE1234F')); assert.ok(!K.panValid('ABC1E1234F')); assert.equal(K.panType('ABCPE1234F'), 'Individual');
  assert.equal(K.maskPan('ABCPE1234F'), 'XXXXXX234F');
  assert.ok(K.gstinValid('27AAPFU0939F1ZV')); assert.ok(!K.gstinValid('27AAPFU0939F1ZX'));
  assert.equal(K.panFromGstin('27AAPFU0939F1ZV'), 'AAPFU0939F');
});
test('encryption round trip', () => { assert.equal(K.decrypt(K.encrypt('ABCPE1234F')), 'ABCPE1234F'); });
test('name similarity', () => { assert.equal(K.nameSimilarity('Ravi Kumar', 'KUMAR RAVI'), 1); assert.ok(K.nameSimilarity('Ravi Kumar', 'Suresh Rao') < 0.2); });
test('schemes: 11 months, month-end clamp, due dates', () => {
  assert.equal(S.maturityDate('2026-12-15'), '2027-11-15');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(S.dueDates('2026-12-15', 'MONTHLY').length, 11);
  assert.equal(S.dueDates('2026-12-15', 'ONE_TIME').length, 1);
  assert.equal(S.expiryDate('2026-12-15'), '2027-12-14');
  assert.ok(S.validateEnrolment({ product: 'G24', frequency: 'MONTHLY', instalment_rupees: 2500 }));
  assert.equal(S.validateEnrolment({ product: 'G24', frequency: 'MONTHLY', instalment_rupees: 1500 }), null);
});
test('market hours (IST)', () => {
  const ist = (s) => Date.parse(s + '+05:30');
  assert.ok(marketOpen(ist('2026-11-23T10:00:00')));   // Monday
  assert.ok(!marketOpen(ist('2026-11-21T12:00:00')));  // Saturday
  assert.ok(!marketOpen(ist('2026-11-23T08:00:00')));
  assert.ok(!marketOpen(ist('2026-12-25T12:00:00')));  // holiday
});
test('bank SMS parsing', () => {
  const c = parseCreditSms('A/c XX1234 credited Rs.1,500.00 on 23-11-26 by UPI Ref No 432112345678. -HDFC Bank');
  assert.deepEqual(c, { amount_paise: 150000, utr: '432112345678' });
  assert.equal(parseCreditSms('Rs 500 debited from A/c XX1234 UPI 432112345678'), null);
});

// ---------- NEW FEATURE UNIT TESTS ----------
test('GSTIN active status and bank account penny drop validation', async () => {
  process.env.GSTIN_PROVIDER = 'mock';
  const gActive = await K.verifyGstin({ gstin: '27AAPFU0939F1ZV', expectedLegalName: 'Shree Jewels' });
  assert.equal(gActive.valid, true);
  assert.equal(gActive.active, true);

  const gBad = await K.verifyGstin({ gstin: '27AAPFU0939F1ZZ' }); // Bad checksum
  assert.equal(gBad.valid, false);

  process.env.BANK_VERIFY_PROVIDER = 'mock';
  assert.ok(K.ifscValid('HDFC0000123'));
  assert.ok(!K.ifscValid('HDFC123'));
  assert.ok(K.bankAccountValid('123456789012'));
  assert.ok(!K.bankAccountValid('123'));

  const bOk = await K.verifyBankAccount({ ifsc: 'HDFC0000123', accountNumber: '123456789012', expectedName: 'Anil Mehta' });
  assert.equal(bOk.verified, true);
  assert.equal(bOk.registeredName, 'Anil Mehta');
});

test('WhatsApp notification engine (mock mode)', async () => {
  WA.clearDispatches();
  await WA.sendOtp('9876543210', '654321');
  await WA.sendMissedNudge({ phone: '9876543210', customerName: 'Ravi', shopName: 'Mehta Jewels', missedCount: 1, nextDueDate: '2026-12-01', instalmentRupees: 1000 });
  await WA.sendCreditConfirmation({ phone: '9876543210', customerName: 'Ravi', shopName: 'Mehta Jewels', amountRupees: 1000, gramsCredited: 0.075, totalGrams: 0.075 });
  await WA.sendMaturityAlert({ phone: '9876543210', customerName: 'Ravi', shopName: 'Mehta Jewels', gramsTotal: 0.075, maturityDate: '2027-10-24' });

  const logs = WA.getRecentDispatches();
  assert.equal(logs.length, 4);
  assert.equal(logs[0].to, '919876543210');
  assert.ok(logs[0].content.includes('654321'));
  assert.ok(logs[1].content.includes('overdue'));
  assert.ok(logs[2].content.includes('received successfully'));
  assert.ok(logs[3].content.includes('matured'));
});

test('RFC 6238 TOTP two-factor authentication', () => {
  const secret = Totp.generateTotpSecret();
  assert.ok(secret.length >= 16);
  const now = Date.now();
  const token = Totp.generateTotpToken(secret, now);
  assert.equal(token.length, 6);
  assert.ok(Totp.verifyTotp(token, secret, 1, now));
  assert.ok(!Totp.verifyTotp('000000', secret, 0, now));
});

test('UPI AutoPay gateway signature verification & parsing', () => {
  // Razorpay
  const rzpSecret = 'rzp_sec_test';
  const rzpBody = JSON.stringify({
    event: 'subscription.charged',
    payload: {
      payment: {
        entity: {
          id: 'pay_test123',
          amount: 100000,
          description: 'GS0818B306',
          acquirer_data: { rrn: '998877665544' },
          notes: { enrolment_id: 1, payment_ref: 'GS0818B306' }
        }
      }
    }
  });
  import('node:crypto').then(crypto => {
    const rzpSig = crypto.createHmac('sha256', rzpSecret).update(rzpBody).digest('hex');
    assert.ok(Gateway.verifyWebhookSignature({ provider: 'razorpay', headers: { 'x-razorpay-signature': rzpSig }, rawBody: rzpBody, secret: rzpSecret }));
    const parsed = Gateway.parseGatewayWebhook({ provider: 'razorpay', body: rzpBody });
    assert.equal(parsed.event, 'PAYMENT_SUCCESS');
    assert.equal(parsed.amountPaise, 100000);
    assert.equal(parsed.utr, '998877665544');
  });
});

test('Scheme pause-once privilege validation', () => {
  const activePlan = { status: 'ACTIVE', paused: 0, pause_count: 0 };
  assert.equal(S.canPauseEnrolment(activePlan).allowed, true);

  const pausedPlan = { status: 'ACTIVE', paused: 1, pause_count: 1 };
  assert.equal(S.canPauseEnrolment(pausedPlan).allowed, false);

  const usedPausePlan = { status: 'ACTIVE', paused: 0, pause_count: 1 };
  assert.equal(S.canPauseEnrolment(usedPausePlan).allowed, false);

  const closedPlan = { status: 'REDEEMED', paused: 0, pause_count: 0 };
  assert.equal(S.canPauseEnrolment(closedPlan).allowed, false);
});

test('Legal compliance texts integrity', () => {
  assert.ok(Legal.SCHEME_TERMS.sections.length >= 4);
  assert.ok(Legal.PRIVACY_POLICY.sections.length >= 3);
  assert.ok(Legal.REFUND_POLICY.sections.length >= 2);
  assert.ok(Legal.SCHEME_TERMS.sections[0].content.includes('advance purchase'));
  assert.ok(!Legal.SCHEME_TERMS.sections[0].content.includes('returns are guaranteed'));
});
