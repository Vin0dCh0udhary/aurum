import crypto from 'node:crypto';
// No 0/O/1/I/L so codes survive being read out loud or typed from a counter.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function makeCode(len) { let s = ''; for (let i = 0; i < len; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)]; return s; }
export const normCode = (s) => String(s || '').toUpperCase().replace(/[\s-]/g, '');
export const makeStoreCode = () => makeCode(6);    // permanent, printed on the counter QR
export const makeInviteCode = () => makeCode(8);   // single use, 7 days
export const makeToken = () => crypto.randomBytes(24).toString('hex');
const tries = new Map();
export function tooManyAttempts(key, max = 5, windowMs = 10 * 60 * 1000) {
  const now = Date.now(); const t = tries.get(key);
  if (!t || t.reset < now) { tries.set(key, { n: 1, reset: now + windowMs }); return false; }
  t.n++; return t.n > max;
}
export const clearAttempts = (key) => tries.delete(key);
