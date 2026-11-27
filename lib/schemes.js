import { addDays, addMonths } from './clock.js';

// ---- FIXED SCHEME OPTIONS (edit here; everything else reads from this file) ----
export const TENURE_MONTHS = 11;          // maturity: redeem from this date
export const HARD_EXPIRY_DAYS = 364;      // redeem-or-refund by this day (365-day advance rule)
export const MIN_PAYMENT_PAISE = 10000;   // Rs 100
export const MAX_PAYMENT_PAISE = 200000;  // Rs 2,000 per payment (keeps UPI MDR at zero)
export const DAILY_USER_CAP_PAISE = 500000; // Rs 5,000 per user per day
export const QUOTE_TTL_MS = 3 * 60 * 1000;
export const QUOTE_GRACE_MS = 5 * 60 * 1000; // customer may take this long after expiry to submit UTR
export const PRESETS_RUPEES = [500, 1000, 1500, 2000];
export const DAILY_PRESETS_RUPEES = [100, 200, 500];

// Scheme Extras
export const PAUSE_MAX_DAYS = 30; // Pause-once allowable extension limit
export const REFERRAL_REWARD = {
  type: 'MAKING_CHARGE_DISCOUNT',
  label: 'Flat 25% Discount on Jewellery Making Charges',
  discountPct: 25,
  cashEquivalent: 0, // Explicit zero: NEVER redeemable for cash
  description: 'Valid only on physical jewellery redemption at the showroom counter.',
};

export const FESTIVALS = [
  { id: 'AKSHAYA_TRITIYA', name: 'Akshaya Tritiya Booster', extraMakingDiscountPct: 10, bonusWindowDays: 7 },
  { id: 'DHANTERAS', name: 'Dhanteras & Diwali Booster', extraMakingDiscountPct: 15, bonusWindowDays: 10 },
  { id: 'NEW_YEAR', name: 'New Year Gold Auspice', extraMakingDiscountPct: 10, bonusWindowDays: 5 },
];

export const PRODUCTS = {
  G24: { label: 'Gold 24K (999)', metal: 'GOLD', purity: 1 },
  G22: { label: 'Gold 22K (916)', metal: 'GOLD', purity: 0.916 },
  G18: { label: 'Gold 18K (750)', metal: 'GOLD', purity: 0.75 },
  S999: { label: 'Silver 999', metal: 'SILVER', purity: 1 },
};
export const FREQUENCIES = {
  DAILY: 'Every day',
  WEEKLY: 'Every week',
  MONTHLY: 'Every month',
  ONE_TIME: 'One-time purchase',
};
export const DISCLAIMER =
  'Advance purchase of gold/silver from your jeweller, redeemable against jewellery or coins after maturity. ' +
  'Not an investment, deposit or digital gold. No returns are promised. Unredeemed balance is refunded by day 364.';

export function maturityDate(start) { return addMonths(start, TENURE_MONTHS); }
export function expiryDate(start) { return addDays(start, HARD_EXPIRY_DAYS); }

export function dueDates(start, freq) {
  const end = maturityDate(start);
  const out = [];
  if (freq === 'ONE_TIME') return [start];
  if (freq === 'DAILY') for (let d = start; d < end; d = addDays(d, 1)) out.push(d);
  else if (freq === 'WEEKLY') for (let d = start; d < end; d = addDays(d, 7)) out.push(d);
  else if (freq === 'MONTHLY') for (let k = 0; k < TENURE_MONTHS; k++) out.push(addMonths(start, k));
  return out;
}
export function dueStatus(enr, paidCount, today) {
  const dues = dueDates(enr.start_date, enr.frequency);
  const dueSoFar = dues.filter((d) => d <= today).length;
  const nextDue = paidCount < dues.length ? dues[paidCount] : null;
  return { totalInstalments: dues.length, dueSoFar, missed: Math.max(0, dueSoFar - paidCount), nextDue, overdue: !!nextDue && nextDue < today };
}
export function validateEnrolment({ product, frequency, instalment_rupees }) {
  if (!PRODUCTS[product]) return 'Unknown product';
  if (!FREQUENCIES[frequency]) return 'Unknown frequency';
  const a = Number(instalment_rupees);
  if (!Number.isInteger(a) || a * 100 < MIN_PAYMENT_PAISE || a * 100 > MAX_PAYMENT_PAISE) return 'Amount must be a whole number between Rs 100 and Rs 2,000';
  return null;
}

// Pause-once evaluation
export function canPauseEnrolment(enr) {
  if (!enr || enr.status !== 'ACTIVE') return { allowed: false, reason: 'Plan is not active' };
  if (enr.paused) return { allowed: false, reason: 'Plan is already paused' };
  if (enr.pause_count && enr.pause_count >= 1) return { allowed: false, reason: 'Plan has already used its one-time pause privilege' };
  return { allowed: true };
}
