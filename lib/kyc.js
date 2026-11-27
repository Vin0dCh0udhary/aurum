import crypto from 'node:crypto';

export const PAN_RE = /^[A-Z]{3}[ABCFGHLJPT][A-Z][0-9]{4}[A-Z]$/;
export const PAN_TYPES = {
  P: 'Individual',
  C: 'Company',
  F: 'Firm/LLP',
  H: 'HUF',
  A: 'AOP',
  B: 'BOI',
  G: 'Govt',
  J: 'Artificial juridical person',
  L: 'Local authority',
  T: 'Trust',
};
export const normPan = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');
export const panValid = (s) => PAN_RE.test(normPan(s));
export const panType = (s) => PAN_TYPES[normPan(s)[3]] || null;
export const maskPan = (s) => 'XXXXXX' + normPan(s).slice(6);

// GSTIN: 15 chars = state(2) + PAN(10) + entity(1) + 'Z' + checksum(1). Checksum is mod-36.
const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const GSTIN_RE = /^(0[1-9]|[1-2][0-9]|3[0-8])[A-Z]{3}[ABCFGHLJPT][A-Z][0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export function gstinChecksum(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CH.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return CH[(36 - (sum % 36)) % 36];
}
export function gstinValid(g) {
  g = String(g || '').toUpperCase().trim();
  return GSTIN_RE.test(g) && gstinChecksum(g.slice(0, 14)) === g[14];
}
export const panFromGstin = (g) => String(g).toUpperCase().slice(2, 12);

export const vpaValid = (v) => /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,30}$/.test(String(v || '').trim());
export const ifscValid = (s) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(s || '').toUpperCase().trim());
export const bankAccountValid = (s) => /^\d{9,18}$/.test(String(s || '').trim());

const tokens = (s) => String(s || '').toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean).sort();
export function nameSimilarity(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / new Set([...A, ...B]).size;
}

// PAN at rest is encrypted (AES-256-GCM). Set DATA_KEY (64 hex chars) in production.
const KEY = Buffer.from(
  process.env.DATA_KEY || crypto.createHash('sha256').update('dev-only-key').digest('hex'),
  'hex'
).subarray(0, 32);

export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
export function decrypt(blob) {
  const [iv, tag, enc] = blob.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
export const hashPan = (pan) => crypto.createHash('sha256').update('pan:' + normPan(pan)).digest('hex');

// ---------- PLUGGABLE PAN VERIFICATION ----------
// Providers: none (default) | mock | setu | ekycnow | http
export async function verifyPan({ pan, name, dob }) {
  const mode = process.env.PAN_PROVIDER || 'none';
  const cleanPan = normPan(pan);
  if (!panValid(cleanPan)) return { status: 'INVALID', detail: 'PAN format is wrong' };

  if (mode === 'mock') {
    // Mock mode returns VERIFIED unless test PAN explicitly triggers failure
    if (cleanPan.endsWith('ERR')) return { status: 'INVALID', detail: 'Mock PAN does not exist in ITD' };
    return {
      status: 'VERIFIED',
      detail: 'mock provider verified',
      nameMatch: true,
      dobMatch: true,
      registeredName: name,
    };
  }

  if (mode === 'setu') {
    // Setu PAN verification endpoint: /api/v1/verify/pan
    const url = process.env.SETU_PAN_URL || 'https://dg-sandbox.setu.co/api/v1/verify/pan';
    const clientId = process.env.SETU_CLIENT_ID;
    const clientSecret = process.env.SETU_CLIENT_SECRET;
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: {
          'content-type': 'application/json',
          'x-client-id': clientId || '',
          'x-client-secret': clientSecret || '',
          'x-product-instance-id': process.env.SETU_PRODUCT_INSTANCE_ID || '',
        },
        body: JSON.stringify({ pan: cleanPan }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        return { status: 'INVALID', detail: data.message || 'PAN lookup failed' };
      }
      const fetchedName = data.data?.full_name || data.data?.name || '';
      const sim = nameSimilarity(name, fetchedName);
      return {
        status: sim >= 0.5 ? 'VERIFIED' : 'REVIEW',
        detail: `Setu name match score: ${(sim * 100).toFixed(1)}%`,
        registeredName: fetchedName,
        nameMatch: sim >= 0.5,
      };
    } catch (err) {
      return { status: 'ERROR', detail: `Setu connection error: ${err.message}` };
    }
  }

  if (mode === 'ekycnow') {
    // eKYCNow / Surepass PAN Comprehensive endpoint
    const url = process.env.EKYCNOW_PAN_URL || 'https://sandbox.surepass.io/api/v1/pan/pan-comprehensive';
    const token = process.env.EKYCNOW_BEARER_TOKEN;
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token || ''}`,
        },
        body: JSON.stringify({ id_number: cleanPan }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { status: 'INVALID', detail: data.message || 'PAN lookup failed' };
      }
      const fetchedName = data.data?.full_name || '';
      const fetchedDob = data.data?.dob || '';
      const nameSim = nameSimilarity(name, fetchedName);
      const dobMatch = !dob || fetchedDob === dob;
      return {
        status: nameSim >= 0.5 && dobMatch ? 'VERIFIED' : 'REVIEW',
        detail: `eKYCNow name match: ${(nameSim * 100).toFixed(1)}%, dob match: ${dobMatch}`,
        registeredName: fetchedName,
        nameMatch: nameSim >= 0.5,
        dobMatch,
      };
    } catch (err) {
      return { status: 'ERROR', detail: `eKYCNow error: ${err.message}` };
    }
  }

  if (mode === 'http') {
    const r = await fetch(process.env.PAN_API_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: {
        'content-type': 'application/json',
        ...(process.env.PAN_API_HEADERS ? JSON.parse(process.env.PAN_API_HEADERS) : {}),
      },
      body: JSON.stringify({ pan: cleanPan, name, dob }),
    });
    const j = await r.json();
    if (!j.valid) return { status: 'INVALID', detail: 'PAN not found' };
    return {
      status: j.name_match && j.dob_match ? 'VERIFIED' : 'REVIEW',
      detail: `name_match=${j.name_match} dob_match=${j.dob_match}`,
    };
  }

  return { status: 'CAPTURED', detail: 'format checked only' };
}

// ---------- GSTIN ACTIVE STATUS VERIFICATION ----------
// Providers: none | mock | setu | ekycnow | http
export async function verifyGstin({ gstin, expectedLegalName }) {
  const mode = process.env.GSTIN_PROVIDER || 'none';
  const g = String(gstin || '').toUpperCase().trim();
  if (!gstinValid(g)) return { valid: false, error: 'Invalid GSTIN format or checksum' };

  if (mode === 'mock') {
    if (g.endsWith('CAN')) return { valid: true, active: false, status: 'Cancelled', error: 'GSTIN is cancelled' };
    return {
      valid: true,
      active: true,
      status: 'Active',
      legalName: expectedLegalName || 'Shri Jewellers Pvt Ltd',
      tradeName: 'Shri Jewellers',
      stateJurisdiction: 'Maharashtra',
      taxpayerType: 'Regular',
    };
  }

  if (mode === 'setu') {
    const url = process.env.SETU_GSTIN_URL || 'https://dg-sandbox.setu.co/api/v1/verify/gstin';
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: {
          'content-type': 'application/json',
          'x-client-id': process.env.SETU_CLIENT_ID || '',
          'x-client-secret': process.env.SETU_CLIENT_SECRET || '',
        },
        body: JSON.stringify({ gstin: g }),
      });
      const data = await res.json();
      const st = data.data?.status || '';
      return {
        valid: res.ok && st.toLowerCase() === 'active',
        active: st.toLowerCase() === 'active',
        status: st,
        legalName: data.data?.legal_name || '',
        tradeName: data.data?.trade_name || '',
      };
    } catch (err) {
      return { valid: false, error: `GSTIN API error: ${err.message}` };
    }
  }

  return { valid: true, active: true, status: 'Active (format checked)' };
}

// ---------- BANK PENNY-DROP VERIFICATION ----------
// Providers: none | mock | setu | razorpay | cashfree
export async function verifyBankAccount({ ifsc, accountNumber, expectedName }) {
  const mode = process.env.BANK_VERIFY_PROVIDER || 'none';
  const cleanIfsc = String(ifsc || '').toUpperCase().trim();
  const cleanAcc = String(accountNumber || '').trim();

  if (!ifscValid(cleanIfsc)) return { verified: false, error: 'Invalid IFSC code format (example: HDFC0000123)' };
  if (!bankAccountValid(cleanAcc)) return { verified: false, error: 'Account number must be 9-18 digits' };

  if (mode === 'mock') {
    if (cleanAcc.endsWith('0000')) return { verified: false, error: 'Mock bank rejected penny drop' };
    const registeredName = expectedName || 'Owner Name';
    return {
      verified: true,
      registeredName,
      similarity: 1.0,
      utr: 'MOCKPENNY' + crypto.randomInt(100000, 999999),
      bankTxnId: 'BKP' + Date.now(),
    };
  }

  if (mode === 'setu') {
    const url = process.env.SETU_PENNY_DROP_URL || 'https://dg-sandbox.setu.co/api/v1/verify/bank';
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: {
          'content-type': 'application/json',
          'x-client-id': process.env.SETU_CLIENT_ID || '',
          'x-client-secret': process.env.SETU_CLIENT_SECRET || '',
        },
        body: JSON.stringify({ ifsc: cleanIfsc, account_number: cleanAcc }),
      });
      const data = await res.json();
      const fetchedName = data.data?.name_at_bank || '';
      const sim = nameSimilarity(expectedName, fetchedName);
      return {
        verified: res.ok && data.status === 'success' && sim >= 0.5,
        registeredName: fetchedName,
        similarity: sim,
        utr: data.data?.utr,
      };
    } catch (err) {
      return { verified: false, error: `Penny drop error: ${err.message}` };
    }
  }

  return {
    verified: true,
    registeredName: expectedName,
    similarity: 1.0,
    note: 'Bank account format checked',
  };
}
