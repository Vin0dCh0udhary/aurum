// All dates are IST. DEV=1 lets you move the clock to test 11-month maturity / day-364 refund.
let offsetDays = Number(process.env.NOW_OFFSET_DAYS || 0);
let fixed = null; // tests only
export const setFixedNow = (ms) => { fixed = ms; };
export const nowMs = () => (fixed ?? Date.now()) + offsetDays * 86400000;
export const advanceDays = (n) => { offsetDays += n; return offsetDays; };
export const getOffset = () => offsetDays;
const IST = 5.5 * 3600 * 1000;
export const istDate = (ms = nowMs()) => new Date(ms + IST).toISOString().slice(0, 10);
export function addDays(d, n) { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
export function addMonths(d, n) {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.toISOString().slice(0, 10);
}
