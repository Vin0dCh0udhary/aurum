// MCX-style hours in IST. Mon-Fri 09:00-23:30 (use MCX_CLOSE_MIN=1435 in US winter => 23:55). Holidays: edit list yearly.
import { istDate, addDays } from './clock.js';
export const HOLIDAYS = (process.env.MARKET_HOLIDAYS || '2026-12-25').split(',').filter(Boolean);
const OPEN_MIN = 9 * 60;
const CLOSE_MIN = Number(process.env.MCX_CLOSE_MIN || 23 * 60 + 30);
const IST = 5.5 * 3600 * 1000;

export function marketOpen(ms) {
  const t = new Date(ms + IST);
  const day = t.getUTCDay();
  if (day === 0 || day === 6) return false;
  if (HOLIDAYS.includes(t.toISOString().slice(0, 10))) return false;
  const min = t.getUTCHours() * 60 + t.getUTCMinutes();
  return min >= OPEN_MIN && min < CLOSE_MIN;
}
export function nextOpenLabel(ms) {
  let d = istDate(ms);
  const t = new Date(ms + IST);
  const min = t.getUTCHours() * 60 + t.getUTCMinutes();
  for (let i = 0; i < 10; i++) {
    const dow = new Date(d + 'T00:00:00Z').getUTCDay();
    const ok = dow !== 0 && dow !== 6 && !HOLIDAYS.includes(d);
    if (ok && !(i === 0 && min >= OPEN_MIN)) return `${d} 09:00 IST`;
    d = addDays(d, 1);
  }
  return 'next trading day';
}
