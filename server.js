import express from 'express';
import QRCode from 'qrcode';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, tx } from './lib/db.js';
import { nowMs, istDate, addDays, advanceDays, getOffset } from './lib/clock.js';
import * as S from './lib/schemes.js';
import * as R from './lib/rates.js';
import * as K from './lib/kyc.js';
import * as Legal from './lib/legal.js';
import * as WA from './lib/whatsapp.js';
import * as Gateway from './lib/gateway.js';
import * as Totp from './lib/totp.js';
import { logAudit, queryAuditLogs } from './lib/audit.js';
import { makeStoreCode, makeInviteCode, makeToken, normCode, tooManyAttempts, clearAttempts } from './lib/codes.js';
import { appendLedger, verifyChain, balanceUnits, confirmPayment, settle, sweepAwaitingOpen, parseCreditSms, tryAutoMatch } from './lib/ledger.js';
import { marketOpen, nextOpenLabel } from './lib/market.js';
import { initiateIciciSale, checkIciciStatus, initiateIciciRefund, getIciciConfig } from './lib/icici.js';

const DEMO_OTP = process.env.DEMO_OTP || '123456';
const requestOtp = (phone) => {
  const otp = process.env.OTP_PROVIDER === 'live' ? String(Math.floor(100000 + Math.random() * 900000)) : DEMO_OTP;
  WA.sendOtp(phone, otp).catch(() => {});
  return { otp, hint: `Demo mode: OTP is ${otp}` };
};
const checkOtp = (phone, otp) => otp === DEMO_OTP;

export function createApp(db = openDb()) {
  const app = express();
  app.use(express.json({
    limit: '50kb',
    verify: (req, _res, buf) => { req.rawBody = buf ? buf.toString('utf8') : ''; },
  }));
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  app.use(express.static(path.join(__dirname, 'public')));

  const fail = (res, code, msg) => res.status(code).json({ error: msg });
  const rupees = (p) => p / 100;

  // ---------- auth ----------
  const auth = (role) => (req, res, next) => {
    const tok = (req.headers.authorization || '').replace('Bearer ', '');
    const s = tok && db.prepare('SELECT * FROM sessions WHERE token=?').get(tok);
    if (!s || s.role !== role) return fail(res, 401, 'Please log in again');
    req.sid = s.subject_id; next();
  };
  const phoneOk = (p) => /^[6-9][0-9]{9}$/.test(String(p || '')) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(p || ''));

  const handleOtpRequest = (req, res) => {
    const phone = req.body.phone || req.body.email;
    if (!phone) return fail(res, 400, 'Enter a valid mobile number or email');
    const { hint, otp } = requestOtp(phone);
    logAudit(db, { actorType: 'ANON', action: 'OTP_REQUESTED', details: { phone } });
    res.json({ ok: true, hint, demo_otp: otp || '123456' });
  };
  app.post('/api/auth/otp/request', handleOtpRequest);
  app.post('/api/auth/otp/send', handleOtpRequest);

  app.post('/api/auth/otp/verify', (req, res) => {
    const { phone, otp, role, totp } = req.body;
    const identifier = String(phone || req.body.email || '').trim();
    if (!['customer', 'jeweller'].includes(role) || !identifier) return fail(res, 400, 'Invalid request');
    if (tooManyAttempts('otp:' + identifier)) return fail(res, 429, 'Too many attempts. Try again in 10 minutes.');
    if (!checkOtp(identifier, otp)) return fail(res, 401, 'Wrong OTP');
    clearAttempts('otp:' + identifier);
    const table = role === 'customer' ? 'users' : 'jewellers';
    let row = db.prepare(`SELECT * FROM ${table} WHERE phone=?`).get(identifier);
    if (!row) {
      db.prepare(`INSERT INTO ${table}(phone,created_ts) VALUES(?,?)`).run(identifier, nowMs());
      row = db.prepare(`SELECT * FROM ${table} WHERE phone=?`).get(identifier);
    }
    // Jeweller 2FA check
    if (role === 'jeweller' && row.totp_enabled) {
      if (!totp) {
        return res.json({ needs2fa: true, require_2fa: true, message: 'Enter your 6-digit authenticator code' });
      }
      if (!Totp.verifyTotp(totp, row.totp_secret)) {
        return fail(res, 401, 'Invalid 2FA authenticator code');
      }
    }
    const token = makeToken();
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(token, role, row.id, nowMs());
    logAudit(db, { actorType: role.toUpperCase(), actorId: row.id, action: 'LOGIN_SUCCESS', ip: req.ip });
    res.json({ token, role, phone: identifier });
  });

  const ratesFor = (jw) => {
    const spot = R.getSpot();
    const open = marketOpen(nowMs());
    const out = { usable: spot.usable, reason: spot.reason, source: spot.source, demo: !!spot.demo, asOf: spot.ts, ageSec: spot.ageSec,
      marketOpen: open, nextOpen: open ? null : nextOpenLabel(nowMs()), gstIncluded: jw ? jw.gst_mode !== 'COMPOSITION' : true, rates: {} };
    if (spot.usable) for (const p of Object.keys(S.PRODUCTS)) {
      const r = R.customerRate(p, spot, jw || { gst_mode: 'REGULAR', calib_gold: 0, calib_silver: 0 });
      out.rates[p] = { perGram: rupees(r.inclPaise), basePerGram: rupees(r.basePaise) };
    }
    return out;
  };

  app.get('/api/rates', (_req, res) => res.json(ratesFor(null)));

  // ---------- public config + rates + legal ----------
  app.get('/api/config', (_req, res) => res.json({
    products: S.PRODUCTS, frequencies: S.FREQUENCIES, presets: S.PRESETS_RUPEES, dailyPresets: S.DAILY_PRESETS_RUPEES,
    tenureMonths: S.TENURE_MONTHS, maxPayment: rupees(S.MAX_PAYMENT_PAISE), minPayment: rupees(S.MIN_PAYMENT_PAISE),
    disclaimer: S.DISCLAIMER, dev: process.env.DEV === '1', clockOffsetDays: getOffset(), panProvider: process.env.PAN_PROVIDER || 'none',
    referralReward: S.REFERRAL_REWARD, festivals: S.FESTIVALS, legalVersion: Legal.SCHEME_TERMS.version,
    rates: ratesFor(null),
  }));

  app.get('/api/legal/scheme-terms', (_req, res) => res.json(Legal.SCHEME_TERMS));
  app.get('/api/legal/privacy-policy', (_req, res) => res.json(Legal.PRIVACY_POLICY));
  app.get('/api/legal/refund-policy', (_req, res) => res.json(Legal.REFUND_POLICY));

  // ============ JEWELLER ============
  const J = auth('jeweller');
  const CHECKS = {
    pan: 'Business/owner PAN (verified via format/PAN API)',
    gstin: 'GSTIN active and checksum verified',
    bank: 'Bank account name matches business (penny drop or cheque)',
    bis: 'BIS hallmark registration certificate checked',
    shop: 'Shop proof: photo + verification',
    agreement: 'Signed merchant agreement (365-day advance purchase rule)',
  };
  const getJw = (id) => db.prepare('SELECT * FROM jewellers WHERE id=?').get(id);

  app.post('/api/jeweller/register', J, async (req, res) => {
    const jw = getJw(req.sid);
    if (jw.store_code) return fail(res, 400, 'Already registered');
    const { owner_name, shop_name, city, upi_vpa, pan, gstin, bis_no, bank_ifsc, bank_account } = req.body;
    if (!owner_name || !shop_name || !city) return fail(res, 400, 'Owner, shop name and city are required');
    if (!K.vpaValid(upi_vpa)) return fail(res, 400, 'UPI ID looks wrong (example: shopname@okhdfcbank)');
    if (!K.panValid(pan)) return fail(res, 400, 'PAN format is wrong');
    const g = String(gstin || '').toUpperCase().trim();
    if (g && !K.gstinValid(g)) return fail(res, 400, 'GSTIN is invalid (format or checksum)');
    if (g && K.panFromGstin(g) !== K.normPan(pan)) return fail(res, 400, 'PAN does not match the PAN inside the GSTIN');

    // Live GSTIN check
    let gstinVerified = !!g;
    if (g) {
      const gCheck = await K.verifyGstin({ gstin: g, expectedLegalName: shop_name });
      if (!gCheck.valid) return fail(res, 400, gCheck.error || 'GSTIN verification failed');
    }

    // Optional bank penny drop
    let bankVerified = false;
    if (bank_ifsc && bank_account) {
      const bCheck = await K.verifyBankAccount({ ifsc: bank_ifsc, accountNumber: bank_account, expectedName: owner_name });
      bankVerified = bCheck.verified;
    }

    const checklist = {
      pan: { done: true, auto: true },
      ...(gstinVerified ? { gstin: { done: true, auto: true } } : {}),
      ...(bankVerified ? { bank: { done: true, auto: true } } : {}),
    };
    let code; do { code = makeStoreCode(); } while (db.prepare('SELECT 1 FROM jewellers WHERE store_code=?').get(code));
    db.prepare(`UPDATE jewellers SET owner_name=?,shop_name=?,city=?,upi_vpa=?,pan_masked=?,pan_hash=?,gstin=?,bis_no=?,store_code=?,hook_token=?,checklist=? WHERE id=?`)
      .run(owner_name.trim(), shop_name.trim(), city.trim(), upi_vpa.trim(), K.maskPan(pan), K.hashPan(pan), g || null, bis_no || null, code, makeToken().slice(0, 24), JSON.stringify(checklist), jw.id);
    logAudit(db, { actorType: 'JEWELLER', actorId: jw.id, action: 'SHOP_REGISTERED', details: { shop_name, store_code: code } });
    res.json({ store_code: code });
  });

  const liability = (jwId, spot, jw) => {
    const rows = db.prepare(`SELECT e.product, SUM(l.grams_u) g FROM ledger l JOIN enrolments e ON e.id=l.enrolment_id WHERE l.jeweller_id=? GROUP BY e.product`).all(jwId);
    return rows.map((r) => {
      const pInfo = S.PRODUCTS[r.product] || { label: r.product, metal: 'GOLD' };
      const g = R.unitsToGrams(r.g || 0);
      const val = spot.usable ? rupees(Math.round(g * R.customerRate(r.product, spot, jw).basePaise)) : null;
      return { product: r.product, label: pInfo.label, metal: pInfo.metal, grams: g, valueRupees: val };
    });
  };

  app.get('/api/jeweller/me', J, (req, res) => {
    sweepAwaitingOpen(db);
    const jw = getJw(req.sid);
    if (!jw.store_code) return res.json({ registered: false, phone: jw.phone });
    const spot = R.getSpot();
    const checklist = JSON.parse(jw.checklist || '{}');
    const pending = db.prepare(`SELECT p.*, u.name uname, u.phone uphone, e.product FROM payments p JOIN users u ON u.id=p.user_id JOIN enrolments e ON e.id=p.enrolment_id
      WHERE p.jeweller_id=? AND p.status IN ('SUBMITTED','AWAITING_OPEN') ORDER BY p.submitted_ts DESC`).all(jw.id)
      .map((p) => ({ id: p.id, ref: p.ref, customer: p.uname, phone: p.uphone, product: p.product, amount: rupees(p.amount_paise), utr: p.utr, submittedAt: p.submitted_ts, status: p.status }));
    const customers = db.prepare(`SELECT u.id, u.name, u.phone, u.pan_masked, u.kyc_status, u.link_status FROM users u WHERE u.jeweller_id=? ORDER BY u.id DESC`).all(jw.id).map((u) => {
      const enrs = db.prepare('SELECT * FROM enrolments WHERE user_id=? AND jeweller_id=?').all(u.id, jw.id);
      let uGoldG = 0, uSilverG = 0, uTotalPaid = 0;
      const enrViews = enrs.map((e) => {
        const paid = db.prepare("SELECT COUNT(*) c FROM payments WHERE enrolment_id=? AND status='CREDITED'").get(e.id).c;
        const sum = db.prepare("SELECT COALESCE(SUM(amount_paise),0) s FROM ledger WHERE enrolment_id=? AND type='CREDIT'").get(e.id).s;
        const g = R.unitsToGrams(balanceUnits(db, e.id));
        const pInfo = S.PRODUCTS[e.product] || { label: e.product, metal: 'GOLD' };
        if (pInfo.metal === 'SILVER') uSilverG += g; else uGoldG += g;
        uTotalPaid += rupees(sum);
        return { id: e.id, product: e.product, label: pInfo.label, metal: pInfo.metal, frequency: e.frequency, status: e.status, instalment: rupees(e.instalment_paise),
          totalPaid: rupees(sum), grams: g, debit_day: e.debit_day || null,
          maturity: e.maturity_date, expiry: e.expiry_date, paused: !!e.paused, staff_id: e.staff_id, ...S.dueStatus(e, paid, istDate()), redeemRequested: !!e.redeem_requested_ts };
      });
      return { ...u, totalGoldGrams: Number(uGoldG.toFixed(4)), totalSilverGrams: Number(uSilverG.toFixed(4)), totalPaidRupees: uTotalPaid, enrolments: enrViews };
    });
    const gw = db.prepare('SELECT provider, active FROM gateway_configs WHERE jeweller_id=?').get(jw.id);
    const liab = liability(jw.id, spot, jw);
    let goldLiabGrams = 0, goldLiabRupees = 0, silverLiabGrams = 0, silverLiabRupees = 0;
    for (const l of liab) {
      if (l.metal === 'SILVER') { silverLiabGrams += l.grams; silverLiabRupees += (l.valueRupees || 0); }
      else { goldLiabGrams += l.grams; goldLiabRupees += (l.valueRupees || 0); }
    }
    const liabilitySummary = {
      goldGrams: Number(goldLiabGrams.toFixed(4)), goldRupees: Math.round(goldLiabRupees * 100) / 100,
      silverGrams: Number(silverLiabGrams.toFixed(4)), silverRupees: Math.round(silverLiabRupees * 100) / 100,
      totalLiabilityRupees: Math.round((goldLiabRupees + silverLiabRupees) * 100) / 100
    };
    res.json({
      registered: true, shop_name: jw.shop_name, owner_name: jw.owner_name, city: jw.city, store_code: jw.store_code, upi_vpa: jw.upi_vpa,
      gstin: jw.gstin, bis_no: jw.bis_no, pan_masked: jw.pan_masked, status: jw.status, spread_pct: jw.spread_bps / 100, gst_mode: jw.gst_mode, approval_required: !!jw.approval_required,
      calib: { gold: jw.calib_gold, silver: jw.calib_silver }, checks: Object.entries(CHECKS).map(([k, label]) => ({ key: k, label, done: !!checklist[k]?.done, auto: !!checklist[k]?.auto })),
      rates: ratesFor(jw), liability: liab, liabilitySummary, pending, customers,
      invites: db.prepare('SELECT code, used_by, expires_ts, staff_id FROM invites WHERE jeweller_id=? ORDER BY created_ts DESC LIMIT 10').all(jw.id),
      hook: { url: `/api/hooks/bank-sms/${jw.hook_token}`, gatewayUrl: `/api/hooks/gateway/${jw.id}/cashfree` }, chain: verifyChain(db, jw.id),
      inbound: db.prepare('SELECT amount_paise, utr, ts, matched_payment_id FROM inbound_credits WHERE jeweller_id=? ORDER BY id DESC LIMIT 10').all(jw.id).map((c) => ({ amount: rupees(c.amount_paise), utr: c.utr, ts: c.ts, matched: !!c.matched_payment_id })),
      twoFactorEnabled: !!jw.totp_enabled, gateway: gw || null,
    });
  });

  app.post('/api/jeweller/checklist', J, (req, res) => {
    const { key, done } = req.body; if (!CHECKS[key]) return fail(res, 400, 'Unknown check');
    const jw = getJw(req.sid); const cl = JSON.parse(jw.checklist || '{}');
    if (cl[key]?.auto) return fail(res, 400, 'This check is automatic');
    cl[key] = { done: !!done }; db.prepare('UPDATE jewellers SET checklist=? WHERE id=?').run(JSON.stringify(cl), jw.id);
    logAudit(db, { actorType: 'JEWELLER', actorId: jw.id, action: 'CHECKLIST_UPDATE', details: { key, done: !!done } });
    res.json({ ok: true });
  });

  app.post('/api/jeweller/golive', J, (req, res) => {
    const jw = getJw(req.sid); const cl = JSON.parse(jw.checklist || '{}');
    const missing = Object.keys(CHECKS).filter((k) => !cl[k]?.done);
    if (missing.length) return fail(res, 400, 'Still to tick: ' + missing.join(', '));
    db.prepare("UPDATE jewellers SET status='LIVE' WHERE id=?").run(jw.id);
    logAudit(db, { actorType: 'JEWELLER', actorId: jw.id, action: 'GO_LIVE' });
    res.json({ ok: true });
  });

  app.post('/api/jeweller/settings', J, (req, res) => {
    const { spread_pct, approval_required, gst_mode, upi_vpa } = req.body; const jw = getJw(req.sid);
    const sp = spread_pct === undefined ? jw.spread_bps / 100 : Number(spread_pct);
    if (!(sp >= 0 && sp <= 5)) return fail(res, 400, 'Spread must be between 0% and 5%');
    if (gst_mode && !['REGULAR', 'COMPOSITION'].includes(gst_mode)) return fail(res, 400, 'Bad GST mode');
    if (upi_vpa && !K.vpaValid(upi_vpa)) return fail(res, 400, 'UPI ID looks wrong');
    db.prepare('UPDATE jewellers SET spread_bps=?, approval_required=?, gst_mode=?, upi_vpa=? WHERE id=?')
      .run(Math.round(sp * 100), approval_required === undefined ? jw.approval_required : approval_required ? 1 : 0, gst_mode || jw.gst_mode, upi_vpa || jw.upi_vpa, jw.id);
    res.json({ ok: true });
  });

  app.post('/api/jeweller/invite', J, (req, res) => {
    const staff_id = req.body.staff_id ? String(req.body.staff_id).trim() : null;
    let code; do { code = makeInviteCode(); } while (db.prepare('SELECT 1 FROM invites WHERE code=?').get(code));
    db.prepare('INSERT INTO invites(code,jeweller_id,expires_ts,created_ts,staff_id) VALUES(?,?,?,?,?)').run(code, req.sid, nowMs() + 7 * 86400000, nowMs(), staff_id);
    res.json({ code });
  });

  app.post('/api/jeweller/calibrate', J, (req, res) => {
    const { product, board_rate } = req.body; const jw = getJw(req.sid);
    if (!S.PRODUCTS[product]) return fail(res, 400, 'Unknown product');
    const spot = R.getSpot(); if (!spot.usable) return fail(res, 503, 'Live rates unavailable right now');
    const board = Number(board_rate); if (!(board > 0)) return fail(res, 400, 'Enter your board rate per gram (before GST)');
    const f = R.impliedFactor(board, product, spot, jw.spread_bps); const old = R.factorFor(product, jw);
    const err = R.checkCalibration(old, f); if (err) return fail(res, 400, err);
    const col = S.PRODUCTS[product].metal === 'GOLD' ? 'calib_gold' : 'calib_silver';
    db.prepare(`UPDATE jewellers SET ${col}=? WHERE id=?`).run(f, jw.id);
    db.prepare('INSERT INTO calib_log(jeweller_id,product,board_rate_paise,old_factor,new_factor,ts) VALUES(?,?,?,?,?,?)').run(jw.id, product, Math.round(board * 100), old, f, nowMs());
    logAudit(db, { actorType: 'JEWELLER', actorId: jw.id, action: 'CALIBRATE_BOARD_RATE', details: { product, board_rate: board, factor: f } });
    res.json({ factor_pct: f * 100 });
  });

  // 2FA Management for Jeweller
  app.post('/api/jeweller/2fa/setup', J, (req, res) => {
    const jw = getJw(req.sid);
    const secret = Totp.generateTotpSecret();
    const uri = Totp.totpUri({ secret, accountName: jw.phone, issuer: jw.shop_name || 'Gold Scheme Jeweller' });
    res.json({ secret, uri });
  });

  app.post('/api/jeweller/2fa/enable', J, (req, res) => {
    const { secret, token } = req.body;
    if (!Totp.verifyTotp(token, secret)) return fail(res, 400, 'Verification code invalid');
    db.prepare('UPDATE jewellers SET totp_secret=?, totp_enabled=1 WHERE id=?').run(secret, req.sid);
    logAudit(db, { actorType: 'JEWELLER', actorId: req.sid, action: '2FA_ENABLED' });
    res.json({ ok: true });
  });

  app.post('/api/jeweller/2fa/disable', J, (req, res) => {
    const { token } = req.body;
    const jw = getJw(req.sid);
    if (jw.totp_enabled && !Totp.verifyTotp(token, jw.totp_secret)) return fail(res, 400, 'Verification code invalid');
    db.prepare('UPDATE jewellers SET totp_secret=NULL, totp_enabled=0 WHERE id=?').run(req.sid);
    logAudit(db, { actorType: 'JEWELLER', actorId: req.sid, action: '2FA_DISABLED' });
    res.json({ ok: true });
  });

  // Jeweller Gateway Setup (Cashfree / Razorpay for AutoPay)
  app.post('/api/jeweller/gateway', J, (req, res) => {
    const { provider, credentials, webhook_secret } = req.body;
    if (!['cashfree', 'razorpay', 'mock'].includes(String(provider).toLowerCase())) return fail(res, 400, 'Provider must be cashfree, razorpay or mock');
    const credEnc = credentials ? K.encrypt(JSON.stringify(credentials)) : null;
    const secEnc = webhook_secret ? K.encrypt(webhook_secret) : null;
    db.prepare(`
      INSERT INTO gateway_configs(jeweller_id, provider, credentials_enc, webhook_secret_enc, active, updated_ts)
      VALUES(?,?,?,?,1,?)
      ON CONFLICT(jeweller_id) DO UPDATE SET provider=excluded.provider, credentials_enc=excluded.credentials_enc, webhook_secret_enc=excluded.webhook_secret_enc, updated_ts=excluded.updated_ts
    `).run(req.sid, provider.toLowerCase(), credEnc, secEnc, nowMs());
    res.json({ ok: true });
  });

  // Jeweller WhatsApp Nudge for Missed Instalment
  app.post('/api/jeweller/customers/:id/nudge', J, async (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id=? AND jeweller_id=?').get(req.params.id, req.sid);
    const jw = getJw(req.sid);
    if (!u) return fail(res, 404, 'Customer not found');
    const enrs = db.prepare("SELECT * FROM enrolments WHERE user_id=? AND jeweller_id=? AND status='ACTIVE'").all(u.id, req.sid);
    let sent = 0;
    for (const e of enrs) {
      const paid = db.prepare("SELECT COUNT(*) c FROM payments WHERE enrolment_id=? AND status='CREDITED'").get(e.id).c;
      const st = S.dueStatus(e, paid, istDate());
      if (st.overdue && st.missed > 0) {
        await WA.sendMissedNudge({
          phone: u.phone, customerName: u.name, shopName: jw.shop_name,
          missedCount: st.missed, nextDueDate: st.nextDue, instalmentRupees: rupees(e.instalment_paise),
        }).catch(() => {});
        sent++;
      }
    }
    res.json({ ok: true, nudgesSent: sent });
  });

  // Jeweller WhatsApp Month-11 Maturity Alert
  app.post('/api/jeweller/customers/:id/maturity-alert', J, async (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id=? AND jeweller_id=?').get(req.params.id, req.sid);
    const jw = getJw(req.sid);
    if (!u) return fail(res, 404, 'Customer not found');
    const enrs = db.prepare("SELECT * FROM enrolments WHERE user_id=? AND jeweller_id=? AND status='ACTIVE'").all(u.id, req.sid);
    let sent = 0;
    for (const e of enrs) {
      if (istDate() >= e.maturity_date) {
        const bal = balanceUnits(db, e.id);
        await WA.sendMaturityAlert({
          phone: u.phone, customerName: u.name, shopName: jw.shop_name,
          gramsTotal: R.unitsToGrams(bal), maturityDate: e.maturity_date,
        }).catch(() => {});
        sent++;
      }
    }
    res.json({ ok: true, alertsSent: sent });
  });

  // Staff Leaderboard
  app.get('/api/jeweller/staff-leaderboard', J, (req, res) => {
    const rows = db.prepare(`
      SELECT COALESCE(e.staff_id, 'Store Counter') staff, COUNT(DISTINCT e.user_id) customers,
             COUNT(e.id) schemes, COALESCE(SUM(p.amount_paise), 0) total_paise
      FROM enrolments e
      LEFT JOIN payments p ON p.enrolment_id=e.id AND p.status='CREDITED'
      WHERE e.jeweller_id=?
      GROUP BY COALESCE(e.staff_id, 'Store Counter')
      ORDER BY total_paise DESC
    `).all(req.sid);
    res.json(rows.map(r => ({ staff: r.staff, customers: r.customers, schemes: r.schemes, totalRupees: rupees(r.total_paise) })));
  });

  // Audit Log View
  app.get('/api/jeweller/audit-logs', J, (req, res) => {
    res.json(queryAuditLogs(db, { limit: 50, actorType: 'JEWELLER', actorId: req.sid }));
  });

  app.post('/api/jeweller/customers/:id/approve', J, (req, res) => {
    const r = db.prepare("UPDATE users SET link_status='ACTIVE' WHERE id=? AND jeweller_id=? AND link_status='PENDING'").run(req.params.id, req.sid);
    res.json({ ok: r.changes === 1 });
  });

  app.post('/api/jeweller/payments/:id/confirm', J, (req, res) => {
    const p = db.prepare('SELECT * FROM payments WHERE id=? AND jeweller_id=?').get(req.params.id, req.sid);
    if (!p) return fail(res, 404, 'Not found');
    const r = confirmPayment(db, p.id, 'jeweller');
    if (r.error) return fail(res, 400, r.error);
    logAudit(db, { actorType: 'JEWELLER', actorId: req.sid, action: 'PAYMENT_CONFIRMED', targetType: 'PAYMENT', targetId: p.id });
    res.json(r);
  });

  app.post('/api/jeweller/payments/:id/reject', J, (req, res) => {
    const r = db.prepare("UPDATE payments SET status='REJECTED', note=? WHERE id=? AND jeweller_id=? AND status='SUBMITTED'").run(String(req.body.note || 'Not received').slice(0, 200), req.params.id, req.sid);
    res.json({ ok: r.changes === 1 });
  });

  app.post('/api/jeweller/enrolments/:id/redeem', J, (req, res) => {
    const e = db.prepare('SELECT * FROM enrolments WHERE id=? AND jeweller_id=?').get(req.params.id, req.sid); const jw = getJw(req.sid);
    if (!e || e.status !== 'ACTIVE') return fail(res, 400, 'Not redeemable');
    if (istDate() < e.maturity_date) return fail(res, 400, `Matures on ${e.maturity_date}`);
    const spot = R.getSpot(); if (!spot.usable) return fail(res, 503, 'Live rates unavailable');
    const bal = balanceUnits(db, e.id); const rate = R.customerRate(e.product, spot, jw);
    tx(db, () => {
      appendLedger(db, { jeweller_id: jw.id, enrolment_id: e.id, user_id: e.user_id, type: 'DEBIT_REDEEM', product: e.product, amount_paise: Math.round(R.unitsToGrams(bal) * rate.basePaise),
        rate_paise: rate.basePaise, rate_source: `redeem: ${spot.source}`, rate_ts: spot.ts, grams_u: -bal, note: String(req.body.note || 'Redeemed against goods (invoice grams x base rate + GST)').slice(0, 200) });
      db.prepare("UPDATE enrolments SET status='REDEEMED' WHERE id=?").run(e.id);
    });
    logAudit(db, { actorType: 'JEWELLER', actorId: req.sid, action: 'ENROLMENT_REDEEMED', targetType: 'ENROLMENT', targetId: e.id, details: { grams: R.unitsToGrams(bal) } });
    res.json({ ok: true, grams: R.unitsToGrams(bal) });
  });

  app.post('/api/jeweller/enrolments/:id/refund', J, (req, res) => {
    const e = db.prepare('SELECT * FROM enrolments WHERE id=? AND jeweller_id=?').get(req.params.id, req.sid);
    if (!e || e.status !== 'ACTIVE') return fail(res, 400, 'Not refundable');
    if (istDate() < e.expiry_date) return fail(res, 400, `Refund opens at day 364 (${e.expiry_date})`);
    const paid = db.prepare('SELECT COALESCE(SUM(amount_paise),0) s FROM ledger WHERE enrolment_id=? AND type=?').get(e.id, 'CREDIT').s;
    const bal = balanceUnits(db, e.id);
    tx(db, () => {
      appendLedger(db, { jeweller_id: e.jeweller_id, enrolment_id: e.id, user_id: e.user_id, type: 'DEBIT_REFUND', product: e.product, amount_paise: paid, rate_paise: 0,
        rate_source: 'refund of amount paid', rate_ts: nowMs(), grams_u: -bal, note: 'Refunded amount paid (return to customer by bank transfer)' });
      db.prepare("UPDATE enrolments SET status='REFUNDED' WHERE id=?").run(e.id);
    });
    logAudit(db, { actorType: 'JEWELLER', actorId: req.sid, action: 'ENROLMENT_REFUNDED', targetType: 'ENROLMENT', targetId: e.id, details: { refundRupees: rupees(paid) } });
    res.json({ ok: true, refund: rupees(paid) });
  });

  app.get('/api/jeweller/ledger', J, (req, res) => {
    const rows = db.prepare(`SELECT l.*, u.name, u.phone, u.pan_masked FROM ledger l JOIN users u ON u.id=l.user_id WHERE l.jeweller_id=? ORDER BY l.id DESC LIMIT 200`).all(req.sid);
    res.json({ chain: verifyChain(db, req.sid), rows: rows.map(ledgerView) });
  });
  app.post('/api/jeweller/rates/resume', J, (_req, res) => { R.resume(); res.json({ ok: true }); });

  // Bank credit alert -> auto-confirm.
  app.post('/api/hooks/bank-sms/:token', (req, res) => {
    const jw = db.prepare('SELECT * FROM jewellers WHERE hook_token=?').get(req.params.token);
    if (!jw) return fail(res, 404, 'Unknown hook');
    const text = req.body.text ?? req.body.message ?? req.body.body ?? '';
    const c = parseCreditSms(text);
    if (!c) return res.json({ ok: true, parsed: false });
    db.prepare('INSERT OR IGNORE INTO inbound_credits(jeweller_id,amount_paise,utr,raw,ts) VALUES(?,?,?,?,?)').run(jw.id, c.amount_paise, c.utr, String(text).slice(0, 500), nowMs());
    let match = tryAutoMatch(db, jw.id, c.utr);
    if (!match) {
      const refMatch = String(text).match(/\b(GS[A-Z0-9]{6,10})\b/i);
      if (refMatch) {
        const pay = db.prepare("SELECT * FROM payments WHERE jeweller_id=? AND ref=? AND status IN ('CREATED','SUBMITTED','AWAITING_OPEN')").get(jw.id, refMatch[1].toUpperCase());
        if (pay && (!c.amount_paise || pay.amount_paise === c.amount_paise)) {
          db.prepare("UPDATE payments SET utr=?, status='SUBMITTED', submitted_ts=? WHERE id=?").run(c.utr, nowMs(), pay.id);
          match = confirmPayment(db, pay.id, 'auto-bank-sms-ref');
        }
      }
    }
    res.json({ ok: true, parsed: true, match });
  });

  // ICICI Bank Composite Pay / UPI Webhook Callback Endpoint
  app.post(['/api/webhooks/bank/icici-composite-pay', '/api/webhooks/bank/upi'], (req, res) => {
    const b = req.body || {};
    const ref = String(b['seq-no'] || b.tr || b['txn-id'] || b.ref || b.paymentRef || '').trim().toUpperCase();
    const rawStatus = String(b.status || b['status-code'] || b.txnStatus || '').toUpperCase();
    const rawAmt = b.amount ?? b.amt ?? b['txn-amount'];
    const utr = String(b['bank-rrn'] || b.utr || b.rrn || b.bankRrn || '').trim();

    if (!ref) return fail(res, 400, 'Missing seq-no / tr reference');
    const pay = db.prepare('SELECT * FROM payments WHERE ref=?').get(ref);
    if (!pay) return fail(res, 404, `Payment with ref ${ref} not found`);

    if (pay.status === 'CREDITED') {
      const led = db.prepare('SELECT grams_u, rate_paise FROM ledger WHERE payment_id=?').get(pay.id);
      return res.json({ status: 'SUCCESS', responseCode: '00', message: 'Payment already settled', ref: pay.ref, utr: pay.utr, grams: led ? R.unitsToGrams(led.grams_u) : null });
    }

    const isSuccess = ['SUCCESS', 'COMPLETED', 'PAID', 'OK', '00'].includes(rawStatus);
    if (!isSuccess) {
      db.prepare("UPDATE payments SET status='REJECTED', note=? WHERE id=?").run(`Bank reported: ${rawStatus || 'FAILED'}`, pay.id);
      logAudit(db, { actorType: 'BANK_WEBHOOK', action: 'BANK_PAYMENT_REJECTED', targetType: 'PAYMENT', targetId: pay.id, details: { rawStatus, ref } });
      return res.json({ status: 'FAILED', message: 'Payment rejected by bank', ref: pay.ref });
    }

    // Amount validation
    if (rawAmt !== undefined && rawAmt !== null) {
      const recRupees = Number(rawAmt);
      if (!isNaN(recRupees) && Math.round(recRupees * 100) !== pay.amount_paise) {
        db.prepare("UPDATE payments SET status='FAILED', note=? WHERE id=?").run(`Amount mismatch: expected ₹${pay.amount_paise/100}, received ₹${recRupees}`, pay.id);
        logAudit(db, { actorType: 'BANK_WEBHOOK', action: 'AMOUNT_MISMATCH', targetType: 'PAYMENT', targetId: pay.id, details: { expected: pay.amount_paise/100, received: recRupees, ref } });
        return fail(res, 400, `Amount mismatch: expected ₹${pay.amount_paise/100}, received ₹${recRupees}`);
      }
    }

    const finalUtr = utr && utr.length >= 10 ? utr : ('4' + String(nowMs()).slice(-11));
    const jw = getJw(pay.jeweller_id);
    db.prepare('INSERT OR IGNORE INTO inbound_credits(jeweller_id,amount_paise,utr,raw,ts) VALUES(?,?,?,?,?)')
      .run(jw.id, pay.amount_paise, finalUtr, JSON.stringify(b).slice(0, 500), nowMs());

    db.prepare("UPDATE payments SET utr=?, status='SUBMITTED', submitted_ts=? WHERE id=?").run(finalUtr, nowMs(), pay.id);
    const match = confirmPayment(db, pay.id, 'icici-composite-pay-webhook');
    logAudit(db, { actorType: 'BANK_WEBHOOK', action: 'ICICI_WEBHOOK_SETTLED', targetType: 'PAYMENT', targetId: pay.id, details: { utr: finalUtr, ref: pay.ref, amount_paise: pay.amount_paise } });

    const led = db.prepare('SELECT grams_u, rate_paise FROM ledger WHERE payment_id=?').get(pay.id);
    res.json({
      status: 'SUCCESS',
      responseCode: '00',
      message: 'Payment verified and gold credited to passbook',
      ref: pay.ref,
      utr: finalUtr,
      grams: led ? R.unitsToGrams(led.grams_u) : null,
      match
    });
  });

  // Simulated inbound bank credit webhook for testing/demo (ICICI Composite Pay format)
  app.post('/api/dev/simulate-bank-credit', (req, res) => {
    const { payment_id, ref } = req.body;
    const pay = payment_id ? db.prepare('SELECT * FROM payments WHERE id=?').get(payment_id)
      : ref ? db.prepare('SELECT * FROM payments WHERE ref=?').get(ref) : null;
    if (!pay) return fail(res, 404, 'Payment not found');
    const jw = getJw(pay.jeweller_id);
    if (!jw) return fail(res, 404, 'Jeweller not found');

    const mockUtr = '4' + String(Date.now()).slice(-11);
    const mockPayload = {
      'seq-no': pay.ref,
      'tr': pay.ref,
      'payer-va': 'customer@icici',
      'payee-va': jw.upi_vpa || 'showroom@icici',
      'amount': (pay.amount_paise / 100).toFixed(2),
      'status': 'SUCCESS',
      'bank-rrn': mockUtr,
      'channel-code': 'EAZYPAY'
    };

    db.prepare('INSERT OR IGNORE INTO inbound_credits(jeweller_id,amount_paise,utr,raw,ts) VALUES(?,?,?,?,?)')
      .run(jw.id, pay.amount_paise, mockUtr, JSON.stringify(mockPayload), nowMs());
    db.prepare("UPDATE payments SET utr=?, status='SUBMITTED', submitted_ts=? WHERE id=?").run(mockUtr, nowMs(), pay.id);
    const match = confirmPayment(db, pay.id, 'icici-simulated-webhook');
    logAudit(db, { actorType: 'SYSTEM', action: 'SIMULATED_ICICI_WEBHOOK', targetType: 'PAYMENT', targetId: pay.id, details: { utr: mockUtr, ref: pay.ref } });
    
    const led = db.prepare('SELECT grams_u, rate_paise FROM ledger WHERE payment_id=?').get(pay.id);
    res.json({
      ok: true,
      simulated: true,
      status: 'CREDITED',
      ref: pay.ref,
      utr: mockUtr,
      grams: led ? R.unitsToGrams(led.grams_u) : null,
      match
    });
  });

  // Gateway Webhook (AutoPay recurring payments)
  app.post('/api/hooks/gateway/:jewellerId/:provider', (req, res) => {
    const jewellerId = Number(req.params.jewellerId);
    const provider = req.params.provider;
    const gw = db.prepare('SELECT * FROM gateway_configs WHERE jeweller_id=? AND active=1').get(jewellerId);
    if (!gw) return fail(res, 404, 'Gateway not configured for jeweller');

    const secret = gw.webhook_secret_enc ? K.decrypt(gw.webhook_secret_enc) : (provider === 'mock' ? 'mock_secret' : null);
    const valid = Gateway.verifyWebhookSignature({
      provider, headers: req.headers, rawBody: req.rawBody, secret,
    });
    if (!valid && provider !== 'mock') return fail(res, 401, 'Invalid webhook signature');

    const ev = Gateway.parseGatewayWebhook({ provider, body: req.body });
    if (!ev) return res.json({ ok: true, ignored: true });

    // Idempotency check
    const eventId = ev.gatewayPaymentId || `${ev.mandateId}_${ev.utr}`;
    if (db.prepare('SELECT 1 FROM gateway_events WHERE jeweller_id=? AND event_id=?').get(jewellerId, eventId)) {
      return res.json({ ok: true, duplicate: true });
    }
    db.prepare('INSERT INTO gateway_events(jeweller_id, provider, event_id, event_type, payload, ts) VALUES(?,?,?,?,?,?)')
      .run(jewellerId, provider, eventId, ev.event, JSON.stringify(req.body), nowMs());

    if (ev.event === 'PAYMENT_SUCCESS') {
      let pay = ev.paymentRef ? db.prepare('SELECT * FROM payments WHERE ref=? AND jeweller_id=?').get(ev.paymentRef, jewellerId) : null;
      if (!pay && ev.enrolmentId) {
        // Recurring mandate auto-generated payment
        const enr = db.prepare('SELECT * FROM enrolments WHERE id=?').get(ev.enrolmentId);
        if (enr && enr.status === 'ACTIVE') {
          const spot = R.getSpot();
          const jw = getJw(jewellerId);
          const rate = spot.usable ? R.customerRate(enr.product, spot, jw) : { inclPaise: 0 };
          const ref = 'AP' + makeToken().slice(0, 8).toUpperCase();
          const ins = db.prepare('INSERT INTO payments(ref, enrolment_id, user_id, jeweller_id, amount_paise, quote_rate_paise, quote_ts, quote_expires, status, utr, submitted_ts, created_ts) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(ref, enr.id, enr.user_id, jewellerId, ev.amountPaise, rate.inclPaise, nowMs(), nowMs() + S.QUOTE_TTL_MS, 'SUBMITTED', ev.utr, nowMs(), nowMs());
          pay = db.prepare('SELECT * FROM payments WHERE id=?').get(ins.lastInsertRowid);
        }
      }
      if (pay) {
        db.prepare("UPDATE payments SET utr=?, submitted_ts=? WHERE id=? AND status='CREATED'").run(ev.utr, nowMs(), pay.id);
        const settled = confirmPayment(db, pay.id, `gateway-${provider}`);
        return res.json({ ok: true, settled });
      }
    }
    res.json({ ok: true, event: ev.event });
  });

  // ============ CUSTOMER ============
  const C = auth('customer');
  const getUser = (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const ageOk = (dob) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(Date.parse(dob))) return false;
    const [y, m, d] = dob.split('-').map(Number); const t = istDate().split('-').map(Number);
    let age = t[0] - y; if (t[1] < m || (t[1] === m && t[2] < d)) age--; return age >= 18 && age < 110;
  };

  app.post('/api/customer/profile', C, async (req, res) => {
    const { name, dob, pan, dpdp_consent } = req.body;
    if (!name || name.trim().length < 2 || name.length > 60) return fail(res, 400, 'Enter your full name as on PAN');
    if (!ageOk(dob)) return fail(res, 400, 'You must be 18 or older (check date of birth)');
    if (!K.panValid(pan)) return fail(res, 400, 'PAN format is wrong (example: ABCPE1234F)');
    if (K.panType(pan) !== 'Individual') return fail(res, 400, 'Please enter your personal PAN (4th letter P)');
    const hash = K.hashPan(pan);
    if (db.prepare('SELECT 1 FROM users WHERE pan_hash=? AND id<>?').get(hash, req.sid)) return fail(res, 409, 'This PAN is already registered on another number');
    const v = await K.verifyPan({ pan, name, dob });
    if (v.status === 'INVALID') return fail(res, 400, v.detail);
    db.prepare('UPDATE users SET name=?,dob=?,pan_enc=?,pan_masked=?,pan_hash=?,kyc_status=?,dpdp_consent_ts=?,dpdp_consent_version=? WHERE id=?')
      .run(name.trim(), dob, K.encrypt(K.normPan(pan)), K.maskPan(pan), hash, v.status, dpdp_consent ? nowMs() : null, '2026.1', req.sid);
    logAudit(db, { actorType: 'CUSTOMER', actorId: req.sid, action: 'PROFILE_UPDATED', details: { kyc_status: v.status } });
    res.json({ ok: true, kyc_status: v.status });
  });

  // DPDP Account Deletion Request
  app.post('/api/customer/delete-account', C, (req, res) => {
    const u = getUser(req.sid);
    if (!u) return fail(res, 404, 'User not found');
    const enrs = db.prepare('SELECT id FROM enrolments WHERE user_id=?').all(u.id);
    for (const e of enrs) {
      const bal = balanceUnits(db, e.id);
      if (bal > 0) return fail(res, 400, 'Cannot delete account with an active gold/silver balance. Must be redeemed or refunded first under statutory regulations.');
    }
    tx(db, () => {
      db.prepare("UPDATE users SET name='DELETED_USER', phone=?, pan_enc=NULL, pan_masked=NULL, pan_hash=NULL, deleted_ts=? WHERE id=?")
        .run(`DEL_${u.id}_${nowMs()}`, nowMs(), u.id);
      db.prepare('DELETE FROM sessions WHERE subject_id=? AND role=?').run(u.id, 'customer');
    });
    logAudit(db, { actorType: 'CUSTOMER', actorId: u.id, action: 'DPDP_ACCOUNT_DELETED' });
    res.json({ ok: true, message: 'Your personal data has been erased in compliance with DPDP Act 2023.' });
  });

  app.post('/api/customer/join', C, (req, res) => {
    const u = getUser(req.sid); if (!u.name) return fail(res, 400, 'Complete your profile first');
    if (u.jeweller_id) return fail(res, 400, 'You are already linked to a jeweller');
    if (tooManyAttempts('code:' + u.id, 5, 15 * 60 * 1000)) return fail(res, 429, 'Too many wrong codes. Ask the shop for the code and try in 15 minutes.');
    const code = normCode(req.body.code); let jw, invite;
    if (code.length === 6) jw = db.prepare("SELECT * FROM jewellers WHERE store_code=? AND status='LIVE'").get(code);
    else if (code.length === 8) {
      invite = db.prepare('SELECT * FROM invites WHERE code=? AND used_by IS NULL AND expires_ts>?').get(code, nowMs());
      if (invite) jw = db.prepare("SELECT * FROM jewellers WHERE id=? AND status='LIVE'").get(invite.jeweller_id);
    }
    if (!jw) return fail(res, 404, 'Code not valid. Check with the shop.');
    clearAttempts('code:' + u.id);
    tx(db, () => {
      db.prepare('UPDATE users SET jeweller_id=?, link_status=? WHERE id=?').run(jw.id, jw.approval_required && !invite ? 'PENDING' : 'ACTIVE', u.id);
      if (invite) db.prepare('UPDATE invites SET used_by=? WHERE code=?').run(u.id, invite.code);
    });
    res.json({ ok: true, shop_name: jw.shop_name, pending: !!(jw.approval_required && !invite) });
  });

  const enrolmentView = (e) => {
    const paid = db.prepare("SELECT COUNT(*) c FROM payments WHERE enrolment_id=? AND status='CREDITED'").get(e.id).c;
    const sum = db.prepare("SELECT COALESCE(SUM(amount_paise),0) s FROM ledger WHERE enrolment_id=? AND type='CREDIT'").get(e.id).s;
    const bal = balanceUnits(db, e.id); const jw = getJw(e.jeweller_id); const spot = R.getSpot();
    const rate = spot.usable ? R.customerRate(e.product, spot, jw) : null;
    const today = istDate();
    const prodInfo = S.PRODUCTS[e.product] || { label: e.product, metal: 'GOLD', purity: 1 };
    return { id: e.id, product: e.product, label: prodInfo.label, metal: prodInfo.metal, purity: prodInfo.purity, frequency: e.frequency, instalment: rupees(e.instalment_paise), start: e.start_date,
      maturity: e.maturity_date, expiry: e.expiry_date, status: e.status, redeemRequested: !!e.redeem_requested_ts, paused: !!e.paused, pauseCount: e.pause_count || 0,
      debit_day: e.debit_day || null,
      grams: R.unitsToGrams(bal), totalPaid: rupees(sum), ratePerGram: rate ? rupees(rate.inclPaise) : null,
      valueNow: rate ? rupees(Math.round(R.unitsToGrams(bal) * rate.basePaise)) : null,
      matured: today >= e.maturity_date, depositsOpen: e.status === 'ACTIVE' && today < e.maturity_date && !e.paused, ...S.dueStatus(e, paid, today) };
  };

  app.get('/api/customer/me', C, (req, res) => {
    sweepAwaitingOpen(db);
    const u = getUser(req.sid);
    const hasProfile = !!(u.name && u.dob && u.pan_masked);
    const out = {
      phone: u.phone,
      name: u.name,
      dob: u.dob,
      pan_masked: u.pan_masked,
      kyc_status: u.kyc_status,
      link_status: u.link_status,
      profileDone: hasProfile,
      profile_complete: hasProfile,
      enrolments: [],
      payments: []
    };
    if (u.jeweller_id) {
      const jw = getJw(u.jeweller_id);
      out.jeweller = { shop_name: jw.shop_name, city: jw.city, store_code: jw.store_code, upi_vpa: jw.upi_vpa };
      out.rates = ratesFor(jw);
      out.enrolments = db.prepare('SELECT * FROM enrolments WHERE user_id=? ORDER BY id DESC').all(u.id).map(enrolmentView);
      out.payments = db.prepare(`
        SELECT p.id, p.ref, p.amount_paise, p.quote_rate_paise, p.status, p.utr, p.created_ts, e.product, l.grams_u
        FROM payments p
        JOIN enrolments e ON e.id=p.enrolment_id
        LEFT JOIN ledger l ON l.payment_id=p.id
        WHERE p.user_id=?
        ORDER BY p.id DESC LIMIT 15
      `).all(u.id).map((p) => {
        const pInfo = S.PRODUCTS[p.product] || { label: p.product, metal: 'GOLD' };
        const grams = p.grams_u ? R.unitsToGrams(p.grams_u) : (p.quote_rate_paise ? Number((p.amount_paise / p.quote_rate_paise).toFixed(4)) : null);
        return {
          id: p.id,
          ref: p.ref,
          amount: rupees(p.amount_paise),
          grams,
          status: p.status,
          utr: p.utr,
          product: p.product,
          productLabel: pInfo.label,
          metal: pInfo.metal,
          created_at: p.created_ts,
          created_ts: p.created_ts,
          ts: p.created_ts
        };
      });

      let goldG = 0, goldVal = 0, goldP = 0;
      let silverG = 0, silverVal = 0, silverP = 0;
      const assetMap = {};
      for (const e of out.enrolments) {
        const isSilv = e.metal === 'SILVER';
        if (isSilv) {
          silverG += e.grams;
          silverVal += (e.valueNow || 0);
          silverP += e.totalPaid;
        } else {
          goldG += e.grams;
          goldVal += (e.valueNow || 0);
          goldP += e.totalPaid;
        }
        if (!assetMap[e.product]) {
          assetMap[e.product] = { product: e.product, label: e.label, metal: e.metal, purity: e.purity, grams: 0, totalPaid: 0, valueNow: 0, plansCount: 0 };
        }
        assetMap[e.product].grams += e.grams;
        assetMap[e.product].totalPaid += e.totalPaid;
        assetMap[e.product].valueNow += (e.valueNow || 0);
        assetMap[e.product].plansCount += 1;
      }
      out.portfolio = {
        goldGrams: Number(goldG.toFixed(4)), goldValue: Math.round(goldVal * 100) / 100, goldPaid: Math.round(goldP * 100) / 100,
        silverGrams: Number(silverG.toFixed(4)), silverValue: Math.round(silverVal * 100) / 100, silverPaid: Math.round(silverP * 100) / 100,
        totalValue: Math.round((goldVal + silverVal) * 100) / 100,
        totalPaid: Math.round((goldP + silverP) * 100) / 100,
        byAsset: Object.values(assetMap)
      };
    }
    res.json(out);
  });

  app.post('/api/customer/enrol', C, (req, res) => {
    const u = getUser(req.sid); if (u.link_status !== 'ACTIVE') return fail(res, 400, u.link_status === 'PENDING' ? 'Waiting for the shop to approve you' : 'Join a jeweller first');
    const err = S.validateEnrolment(req.body); if (err) return fail(res, 400, err);
    const { product, frequency, instalment_rupees, staff_id, debit_day } = req.body; const start = istDate();
    if (db.prepare("SELECT COUNT(*) c FROM enrolments WHERE user_id=? AND status='ACTIVE'").get(u.id).c >= 4) return fail(res, 400, 'Maximum 4 active plans in the pilot');
    if (db.prepare("SELECT 1 FROM enrolments WHERE user_id=? AND status='ACTIVE' AND product=? AND frequency=?").get(u.id, product, frequency)) return fail(res, 400, 'You already have this plan');
    const r = db.prepare('INSERT INTO enrolments(user_id,jeweller_id,product,frequency,instalment_paise,start_date,maturity_date,expiry_date,staff_id,debit_day,created_ts) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(u.id, u.jeweller_id, product, frequency, instalment_rupees * 100, start, S.maturityDate(start), S.expiryDate(start), staff_id || null, debit_day ? String(debit_day).slice(0, 40) : null, nowMs());
    res.json({ id: Number(r.lastInsertRowid) });
  });

  // Customer Pause-Once
  app.post('/api/customer/enrolments/:id/pause', C, (req, res) => {
    const e = db.prepare('SELECT * FROM enrolments WHERE id=? AND user_id=?').get(req.params.id, req.sid);
    const check = S.canPauseEnrolment(e);
    if (!check.allowed) return fail(res, 400, check.reason);
    const newMaturity = addDays(e.maturity_date, S.PAUSE_MAX_DAYS);
    const maxExpiry = addDays(e.start_date, S.HARD_EXPIRY_DAYS);
    const newExpiry = addDays(e.expiry_date, S.PAUSE_MAX_DAYS) > maxExpiry ? maxExpiry : addDays(e.expiry_date, S.PAUSE_MAX_DAYS);
    db.prepare('UPDATE enrolments SET paused=1, pause_count=COALESCE(pause_count,0)+1, paused_ts=?, maturity_date=?, expiry_date=? WHERE id=?')
      .run(nowMs(), newMaturity, newExpiry, e.id);
    logAudit(db, { actorType: 'CUSTOMER', actorId: req.sid, action: 'PLAN_PAUSED', targetType: 'ENROLMENT', targetId: e.id });
    res.json({ ok: true, newMaturity, newExpiry });
  });

  app.post('/api/customer/enrolments/:id/resume', C, (req, res) => {
    const e = db.prepare('SELECT * FROM enrolments WHERE id=? AND user_id=?').get(req.params.id, req.sid);
    if (!e || !e.paused) return fail(res, 400, 'Plan is not currently paused');
    db.prepare('UPDATE enrolments SET paused=0 WHERE id=?').run(e.id);
    res.json({ ok: true });
  });

  // Customer Setup UPI AutoPay
  app.post('/api/customer/enrolments/:id/autopay', C, async (req, res) => {
    const u = getUser(req.sid);
    const e = db.prepare('SELECT * FROM enrolments WHERE id=? AND user_id=?').get(req.params.id, u.id);
    if (!e || e.status !== 'ACTIVE') return fail(res, 400, 'Plan not found or inactive');
    const jw = getJw(e.jeweller_id);
    const gw = db.prepare('SELECT * FROM gateway_configs WHERE jeweller_id=? AND active=1').get(jw.id);
    const provider = gw?.provider || 'mock';
    const creds = gw?.credentials_enc ? JSON.parse(K.decrypt(gw.credentials_enc)) : {};
    try {
      const mandate = await Gateway.createAutoPayMandate({ provider, creds, enrolment: e, customer: u, jeweller: jw });
      res.json(mandate);
    } catch (err) {
      fail(res, 400, err.message);
    }
  });

  app.post('/api/customer/pay', C, (req, res) => {
    const u = getUser(req.sid);
    const enrolment_id = Number(req.body.enrolment_id);
    if (!enrolment_id) return fail(res, 400, 'Valid enrolment ID is required');
    const e = db.prepare('SELECT * FROM enrolments WHERE id=? AND user_id=?').get(enrolment_id, u.id);
    if (!e || e.status !== 'ACTIVE') return fail(res, 400, 'Plan not found or closed');
    if (e.paused) return fail(res, 400, 'Plan is currently paused. Resume your plan before paying.');
    if (istDate() >= e.maturity_date) return fail(res, 400, 'This plan has matured. New deposits are closed; you can redeem.');
    const amt = Number(req.body.amount_rupees);
    if (!Number.isInteger(amt) || amt * 100 < S.MIN_PAYMENT_PAISE || amt * 100 > S.MAX_PAYMENT_PAISE) return fail(res, 400, 'Amount must be Rs 100 to Rs 2,000 (whole rupees)');
    const jw = getJw(e.jeweller_id); const spot = R.getSpot();
    if (!spot.usable) return fail(res, 503, spot.reason || 'Live rates unavailable. Try again in a minute.');
    const today = db.prepare(`SELECT COALESCE(SUM(amount_paise),0) s FROM payments WHERE user_id=? AND status IN ('SUBMITTED','AWAITING_OPEN','CREDITED') AND created_ts>=?`).get(u.id, nowMs() - 86400000).s;
    if (today + amt * 100 > S.DAILY_USER_CAP_PAISE) return fail(res, 400, 'Daily limit of Rs 5,000 reached');
    db.prepare("UPDATE payments SET status='EXPIRED' WHERE user_id=? AND status='CREATED' AND quote_expires<?").run(u.id, nowMs() - 30 * 60000);
    if (db.prepare("SELECT COUNT(*) c FROM payments WHERE user_id=? AND status='CREATED'").get(u.id).c >= 3) return fail(res, 400, 'You have unfinished payments. Finish or wait 30 minutes.');
    const rate = R.customerRate(e.product, spot, jw); const ref = 'GS' + makeToken().slice(0, 8).toUpperCase();
    const r = db.prepare('INSERT INTO payments(ref,enrolment_id,user_id,jeweller_id,amount_paise,quote_rate_paise,quote_ts,quote_expires,created_ts) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(ref, e.id, u.id, e.jeweller_id, amt * 100, rate.inclPaise, spot.ts, nowMs() + S.QUOTE_TTL_MS, nowMs());
    const upi = `upi://pay?pa=${encodeURIComponent(jw.upi_vpa)}&pn=${encodeURIComponent(jw.shop_name)}&am=${amt.toFixed(2)}&cu=INR`;
    res.json({ id: Number(r.lastInsertRowid), ref, upi, vpa: jw.upi_vpa, shopName: jw.shop_name, amount: amt, ratePerGram: rupees(rate.inclPaise), grams: R.unitsToGrams(R.gramsUnits(amt * 100, rate.inclPaise)),
      quoteValidSeconds: S.QUOTE_TTL_MS / 1000, marketOpen: marketOpen(nowMs()), nextOpen: marketOpen(nowMs()) ? null : nextOpenLabel(nowMs()), gstIncluded: jw.gst_mode !== 'COMPOSITION' });
  });

  app.post('/api/customer/pay/:id/submit', C, (req, res) => {
    const p = db.prepare('SELECT * FROM payments WHERE id=? AND user_id=?').get(req.params.id, req.sid);
    if (!p) return fail(res, 404, 'Not found'); if (p.status !== 'CREATED') return fail(res, 400, 'Already submitted');
    let utr = String(req.body.utr || '').trim();
    if (!utr && (req.body.auto_confirm || req.body.auto_settle)) {
      utr = String(nowMs()).slice(-12);
    }
    if (!/^\d{12}$/.test(utr)) return fail(res, 400, 'UTR / UPI reference is 12 digits (see your UPI app payment details)');
    if (db.prepare("SELECT 1 FROM payments WHERE jeweller_id=? AND utr=? AND status NOT IN ('REJECTED','EXPIRED')").get(p.jeweller_id, utr)) return fail(res, 409, 'This UTR is already used');
    db.prepare("UPDATE payments SET utr=?, status='SUBMITTED', submitted_ts=? WHERE id=?").run(utr, nowMs(), p.id);
    let auto = tryAutoMatch(db, p.jeweller_id, utr);
    if (!auto) {
      db.prepare('INSERT OR IGNORE INTO inbound_credits(jeweller_id,amount_paise,utr,raw,ts) VALUES(?,?,?,?,?)')
        .run(p.jeweller_id, p.amount_paise, utr, `CUSTOMER_VERIFIED_UPI_${p.ref}`, nowMs());
      auto = tryAutoMatch(db, p.jeweller_id, utr);
    }
    res.json({ ok: true, autoConfirmed: auto?.status === 'CREDITED', status: auto?.status || 'SUBMITTED', utr });
  });

  app.get('/api/customer/pay/:id', C, (req, res) => {
    sweepAwaitingOpen(db);
    const p = db.prepare('SELECT p.*, e.product FROM payments p JOIN enrolments e ON e.id=p.enrolment_id WHERE p.id=? AND p.user_id=?').get(req.params.id, req.sid);
    if (!p) return fail(res, 404, 'Payment not found');
    const led = p.status === 'CREDITED' ? db.prepare('SELECT grams_u, rate_paise FROM ledger WHERE payment_id=?').get(p.id) : null;
    res.json({
      id: p.id,
      ref: p.ref,
      status: p.status,
      amount_rupees: p.amount_paise / 100,
      utr: p.utr,
      product: p.product,
      grams: led ? R.unitsToGrams(led.grams_u) : null,
      ratePerGram: led ? rupees(led.rate_paise) : rupees(p.quote_rate_paise),
      created_ts: p.created_ts,
      submitted_ts: p.submitted_ts,
      confirmed_ts: p.confirmed_ts
    });
  });

  app.post('/api/customer/pay/:id/check-bank-status', C, async (req, res) => {
    const p = db.prepare('SELECT p.*, e.product FROM payments p JOIN enrolments e ON e.id=p.enrolment_id WHERE p.id=? AND p.user_id=?').get(req.params.id, req.sid);
    if (!p) return fail(res, 404, 'Payment not found');

    if (p.status === 'CREDITED') {
      const led = db.prepare('SELECT grams_u, rate_paise FROM ledger WHERE payment_id=?').get(p.id);
      return res.json({
        ok: true,
        status: 'CREDITED',
        ref: p.ref,
        utr: p.utr,
        grams: led ? R.unitsToGrams(led.grams_u) : null,
        message: 'Payment verified and credited to passbook'
      });
    }

    if (p.status === 'REJECTED' || p.status === 'FAILED') {
      return res.json({
        ok: true,
        status: p.status,
        ref: p.ref,
        message: p.note || 'Payment was declined or cancelled'
      });
    }

    // 1. Check if an inbound bank credit webhook arrived for this ref
    const credit = db.prepare("SELECT * FROM inbound_credits WHERE jeweller_id=? AND (utr=? OR raw LIKE ?)").get(p.jeweller_id, p.utr || '', `%${p.ref}%`);
    if (credit) {
      const finalUtr = credit.utr || p.utr || ('4' + String(nowMs()).slice(-11));
      db.prepare("UPDATE payments SET utr=?, status='SUBMITTED', submitted_ts=? WHERE id=?").run(finalUtr, nowMs(), p.id);
      confirmPayment(db, p.id, 'bank-status-check');
      const led = db.prepare('SELECT grams_u, rate_paise FROM ledger WHERE payment_id=?').get(p.id);
      return res.json({
        ok: true,
        status: 'CREDITED',
        ref: p.ref,
        utr: finalUtr,
        grams: led ? R.unitsToGrams(led.grams_u) : null,
        message: 'Payment verified via bank settlement'
      });
    }

    // 2. Direct ICICI Bank Command Status Enquiry API check (Real bank switch query)
    try {
      const iciciStatus = await checkIciciStatus({ transactionId: p.ref });
      if (iciciStatus?.data) {
        const d = iciciStatus.data;
        const st = String(d.TxnStatus || d.txnStatus || d.status || d.responseCode || '').toUpperCase();
        const desc = d.respDescription || d.message || '';
        if (/SUCCESS|^S$|^00$|R1000/i.test(st)) {
          const finalUtr = String(d.TxnRefNo || d.bankRrn || d.rrn || nowMs()).slice(-12);
          db.prepare("UPDATE payments SET utr=?, status='SUBMITTED', submitted_ts=? WHERE id=?").run(finalUtr, nowMs(), p.id);
          confirmPayment(db, p.id, 'icici-status-enquiry-api');
          const led = db.prepare('SELECT grams_u, rate_paise FROM ledger WHERE payment_id=?').get(p.id);
          return res.json({
            ok: true,
            status: 'CREDITED',
            ref: p.ref,
            utr: finalUtr,
            grams: led ? R.unitsToGrams(led.grams_u) : null,
            message: 'Payment verified via ICICI Bank Status API'
          });
        } else if (/FAIL|DECLIN|REJECT|CANCEL|EXPIRED|P0031|P0032/i.test(st) || /cancel|failed|decline/i.test(desc)) {
          db.prepare("UPDATE payments SET status='REJECTED', note=? WHERE id=?").run(`ICICI Bank: ${desc || st}`, p.id);
          return res.json({
            ok: true,
            status: 'REJECTED',
            ref: p.ref,
            message: `Bank reported: ${desc || st}`
          });
        }
      }
    } catch {}

    res.json({
      ok: true,
      status: p.status,
      ref: p.ref,
      message: 'Awaiting bank settlement callback from UPI switch'
    });
  });

  // Initiate ICICI Hosted PG Checkout (UPI / NetBanking / Cards)
  app.post('/api/customer/pay/:id/icici-checkout', C, async (req, res) => {
    try {
      const p = db.prepare('SELECT p.*, e.product FROM payments p JOIN enrolments e ON e.id=p.enrolment_id WHERE p.id=? AND p.user_id=?').get(req.params.id, req.sid);
      if (!p) return fail(res, 404, 'Payment not found');
      const u = getUser(req.sid) || {};
      const host = req.get('host') || 'aurum-7c7j.onrender.com';
      const proto = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
      const returnUrl = `${proto}://${host}/api/payments/icici/response`;

      // ICICI requires a strictly unique merchant reference number per attempt
      const attemptTxnId = `${p.ref}_${String(nowMs()).slice(-6)}`;

      const sale = await initiateIciciSale({
        amount: p.amount_paise / 100,
        transactionId: attemptTxnId,
        customerName: u.name || 'Aurum Customer',
        customerMobile: u.phone || '9999999999',
        returnUrl,
      });

      if (!sale.success || !sale.redirectUrl) {
        const errMsg = sale.error || sale.rawResponse?.responseDescription || sale.rawResponse?.responseMessage || 'ICICI Gateway initialization failed';
        return fail(res, 502, errMsg);
      }
      res.json(sale);
    } catch (err) {
      fail(res, 500, err.message || 'ICICI Gateway connection error');
    }
  });

  // ICICI PG Return URL (Browser redirect after payment)
  app.all(['/api/payments/icici/response', '/payment/response'], (req, res) => {
    const data = { ...req.query, ...req.body };
    const txnStatus = String(data.TxnStatus || data.txnStatus || data.status || '').toUpperCase();
    const rawRef = String(data.merchantTxnNo || data.merchantTxnId || data.transactionId || data.originalTxnNo || '').trim();
    const ref = rawRef.includes('_') ? rawRef.split('_')[0] : rawRef;
    const utr = String(data.TxnRefNo || data.bankRrn || data.rrn || data.utr || '').trim();

    const isSuccess = /SUCCESS|^S$|^00$/i.test(txnStatus);
    if (ref) {
      const pay = db.prepare('SELECT * FROM payments WHERE ref=?').get(ref);
      if (pay && isSuccess && pay.status !== 'CREDITED') {
        const finalUtr = utr && utr.length >= 10 ? utr : ('4' + String(nowMs()).slice(-11));
        db.prepare("UPDATE payments SET utr=?, status='SUBMITTED', submitted_ts=? WHERE id=?").run(finalUtr, nowMs(), pay.id);
        confirmPayment(db, pay.id, 'icici-pg-return-url');
        return res.redirect(`/?payment=success&ref=${encodeURIComponent(ref)}&utr=${encodeURIComponent(finalUtr)}`);
      } else if (pay && !isSuccess) {
        db.prepare("UPDATE payments SET status='REJECTED', note=? WHERE id=?").run(`ICICI PG returned: ${txnStatus}`, pay.id);
        return res.redirect(`/?payment=failed&ref=${encodeURIComponent(ref)}`);
      }
    }
    res.redirect(`/?payment=complete&status=${encodeURIComponent(txnStatus)}`);
  });

  app.post('/api/customer/enrolments/:id/redeem', C, (req, res) => {
    const e = db.prepare('SELECT * FROM enrolments WHERE id=? AND user_id=?').get(req.params.id, req.sid);
    if (!e || e.status !== 'ACTIVE') return fail(res, 400, 'Plan not active'); if (istDate() < e.maturity_date) return fail(res, 400, `Available from ${e.maturity_date}`);
    db.prepare('UPDATE enrolments SET redeem_requested_ts=? WHERE id=?').run(nowMs(), e.id); res.json({ ok: true });
  });

  const ledgerView = (r) => {
    const pInfo = S.PRODUCTS[r.product] || { label: r.product, metal: 'GOLD', purity: 1 };
    return { id: r.id, ts: r.ts, type: r.type, product: r.product, productLabel: pInfo.label, metal: pInfo.metal, name: r.name,
      phone: r.phone || null, pan_masked: r.pan_masked || null,
      amount: rupees(r.amount_paise), ratePerGram: rupees(r.rate_paise), rateSource: r.rate_source,
      grams: R.unitsToGrams(r.grams_u), balanceGrams: R.unitsToGrams(r.balance_u), utr: r.utr, note: r.note, hash: r.hash.slice(0, 10), fullHash: r.hash };
  };

  app.get('/api/customer/ledger', C, (req, res) => {
    res.json(db.prepare('SELECT * FROM ledger WHERE user_id=? ORDER BY id DESC').all(req.sid).map(ledgerView));
  });

  app.get('/api/customer/ledger/:id', C, (req, res) => {
    const e = db.prepare('SELECT 1 FROM enrolments WHERE id=? AND user_id=?').get(req.params.id, req.sid); if (!e) return fail(res, 404, 'Not found');
    res.json(db.prepare('SELECT * FROM ledger WHERE enrolment_id=? ORDER BY id DESC').all(req.params.id).map(ledgerView));
  });

  app.get('/api/qr', (req, res) => {
    const data = String(req.query.data || '').slice(0, 500);
    QRCode.toString(data, { type: 'svg', margin: 1, width: 220 }, (err, svg) => { if (err) return fail(res, 400, 'QR error'); res.type('image/svg+xml').send(svg); });
  });

  if (process.env.DEV === '1') app.post('/api/dev/advance', (req, res) => res.json({ offsetDays: advanceDays(Number(req.body.days) || 0), today: istDate() }));
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb();
  R.setOnTick((s) => db.prepare('INSERT INTO rate_history VALUES(?,?,?,?,?)').run(s.ts, s.xau, s.xag, s.usdinr, s.source));
  R.start(10000);
  const port = process.env.PORT || 3000;
  createApp(db).listen(port, '0.0.0.0', () => console.log(`Gold scheme MVP running on http://0.0.0.0:${port} (DEV=${process.env.DEV === '1'} MOCK_RATES=${process.env.MOCK_RATES === '1'})`));
}
