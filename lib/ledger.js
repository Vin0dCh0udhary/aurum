import crypto from 'node:crypto';
import { tx } from './db.js';
import { nowMs } from './clock.js';
import { marketOpen } from './market.js';
import { customerRate, gramsUnits, getSpot, spotAt } from './rates.js';
import { QUOTE_GRACE_MS } from './schemes.js';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const GENESIS = 'GENESIS';
const body = (e) => JSON.stringify([e.jeweller_id, e.enrolment_id, e.user_id, e.type, e.product, e.amount_paise, e.rate_paise, e.rate_source, e.rate_ts, e.grams_u, e.balance_u, e.payment_id, e.utr, e.note, e.ts]);

// Append-only, hash-chained per jeweller. Never UPDATE or DELETE ledger rows.
export function appendLedger(db, e) {
  const last = db.prepare('SELECT hash FROM ledger WHERE jeweller_id=? ORDER BY id DESC LIMIT 1').get(e.jeweller_id);
  const prev = last?.hash || GENESIS;
  const bal = db.prepare('SELECT balance_u FROM ledger WHERE enrolment_id=? ORDER BY id DESC LIMIT 1').get(e.enrolment_id)?.balance_u || 0;
  const row = { note: null, utr: null, payment_id: null, ...e, balance_u: bal + e.grams_u, ts: e.ts ?? nowMs() };
  if (row.balance_u < 0) throw new Error('Ledger balance cannot go negative');
  const hash = sha(prev + body(row));
  db.prepare(`INSERT INTO ledger(jeweller_id,enrolment_id,user_id,type,product,amount_paise,rate_paise,rate_source,rate_ts,grams_u,balance_u,payment_id,utr,note,ts,prev_hash,hash)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.jeweller_id, row.enrolment_id, row.user_id, row.type, row.product, row.amount_paise,
    row.rate_paise, row.rate_source, row.rate_ts, row.grams_u, row.balance_u, row.payment_id, row.utr, row.note, row.ts, prev, hash);
  return row;
}
export function verifyChain(db, jewellerId) {
  const rows = db.prepare('SELECT * FROM ledger WHERE jeweller_id=? ORDER BY id').all(jewellerId);
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== prev || sha(prev + body(r)) !== r.hash) return { ok: false, brokenAtId: r.id, rows: rows.length };
    prev = r.hash;
  }
  return { ok: true, rows: rows.length };
}
export const balanceUnits = (db, enrId) => db.prepare('SELECT balance_u FROM ledger WHERE enrolment_id=? ORDER BY id DESC LIMIT 1').get(enrId)?.balance_u || 0;

// Decide the rate for a confirmed payment, then credit the ledger. Rules:
//  - paid while market closed -> priced at first rate after reopening (status AWAITING_OPEN until then)
//  - paid while open, within quote window (+grace) -> the quote the customer saw
//  - paid while open, quote expired -> rate at the moment of payment (from rate history), else current
export function settle(db, paymentId) {
  return tx(db, () => {
    const p = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
    if (!p || !['SUBMITTED', 'AWAITING_OPEN'].includes(p.status)) return { skipped: true, status: p?.status };
    const jw = db.prepare('SELECT * FROM jewellers WHERE id=?').get(p.jeweller_id);
    const enr = db.prepare('SELECT * FROM enrolments WHERE id=?').get(p.enrolment_id);
    const paidAt = p.submitted_ts;
    let ratePaise, rateTs, source;
    if (paidAt <= p.quote_expires + QUOTE_GRACE_MS) {
      ratePaise = p.quote_rate_paise; rateTs = p.quote_ts; source = 'quote shown to customer';
    } else if (!marketOpen(paidAt)) {
      if (!marketOpen(nowMs())) { db.prepare("UPDATE payments SET status='AWAITING_OPEN' WHERE id=?").run(p.id); return { status: 'AWAITING_OPEN' }; }
      const s = getSpot(); if (!s.usable) return { status: 'AWAITING_RATES' };
      ratePaise = customerRate(enr.product, s, jw).inclPaise; rateTs = s.ts; source = `reopen: ${s.source}`;
    } else {
      const s = spotAt(paidAt, db) || (getSpot().usable ? getSpot() : null);
      if (!s) return { status: 'AWAITING_RATES' };
      ratePaise = customerRate(enr.product, s, jw).inclPaise; rateTs = s.ts; source = `at payment time: ${s.source}`;
    }
    const grams = gramsUnits(p.amount_paise, ratePaise);
    appendLedger(db, { jeweller_id: p.jeweller_id, enrolment_id: p.enrolment_id, user_id: p.user_id, type: 'CREDIT', product: enr.product,
      amount_paise: p.amount_paise, rate_paise: ratePaise, rate_source: source, rate_ts: rateTs, grams_u: grams, payment_id: p.id, utr: p.utr });
    db.prepare("UPDATE payments SET status='CREDITED' WHERE id=?").run(p.id);
    return { status: 'CREDITED', grams_u: grams, ratePaise };
  });
}
export function confirmPayment(db, paymentId, by) {
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
  if (!p || p.status !== 'SUBMITTED') return { error: 'Payment is not waiting for confirmation' };
  db.prepare('UPDATE payments SET confirmed_ts=?, confirmed_by=? WHERE id=?').run(nowMs(), by, paymentId);
  return settle(db, paymentId);
}
export function sweepAwaitingOpen(db) {
  for (const p of db.prepare("SELECT id FROM payments WHERE status IN ('AWAITING_OPEN')").all()) settle(db, p.id);
}

// Bank-credit SMS -> {amount_paise, utr}. Works with typical "credited ... UPI Ref No 123456789012" alerts.
export function parseCreditSms(text) {
  const t = String(text || '');
  if (!/credited|received|deposited/i.test(t)) return null;
  const am = t.match(/(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)/i);
  const utr = t.match(/(?:UPI|Ref(?:erence)?\.?\s*(?:No\.?)?|UTR|RRN)[^\d]{0,12}(\d{12})/i) || t.match(/\b(\d{12})\b/);
  if (!am || !utr) return null;
  return { amount_paise: Math.round(parseFloat(am[1].replace(/,/g, '')) * 100), utr: utr[1] };
}
// Called when a credit alert arrives OR when a customer submits a UTR. Auto-confirms on exact UTR + amount match.
export function tryAutoMatch(db, jewellerId, utr) {
  const credit = db.prepare('SELECT * FROM inbound_credits WHERE jeweller_id=? AND utr=? AND matched_payment_id IS NULL').get(jewellerId, utr);
  const pay = db.prepare("SELECT * FROM payments WHERE jeweller_id=? AND utr=? AND status='SUBMITTED'").get(jewellerId, utr);
  if (!credit || !pay) return null;
  if (credit.amount_paise !== pay.amount_paise) return { mismatch: true, payment_id: pay.id };
  db.prepare('UPDATE inbound_credits SET matched_payment_id=? WHERE id=?').run(pay.id, credit.id);
  return confirmPayment(db, pay.id, 'auto-bank-alert');
}
