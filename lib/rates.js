import { PRODUCTS } from './schemes.js';

export const OZ = 31.1035;
export const GST = 0.03;
export const DUTY = Number(process.env.IMPORT_DUTY ?? 0.15); // 10% BCD + 5% AIDC (config; verify when budget changes)
export const STALE_MS = 10 * 60 * 1000;
export const MAX_JUMP = 0.03; // >3% jump between refreshes halts quoting

// ---- pure maths ----
export const parityPerGram = (spotUsdPerOz, usdInr, duty = DUTY) => (spotUsdPerOz / OZ) * usdInr * (1 + duty);
export function productParity(prod, spot) {
  const p = PRODUCTS[prod];
  const metalSpot = p.metal === 'GOLD' ? spot.xau : spot.xag;
  return parityPerGram(metalSpot, spot.usdinr) * p.purity;
}
export const factorFor = (prod, jw) => (PRODUCTS[prod].metal === 'GOLD' ? jw.calib_gold : jw.calib_silver) || 0;
export const gstFactor = (jw) => (jw.gst_mode === 'COMPOSITION' ? 1 : 1 + GST);

// Customer rate per gram in paise. base = before GST. incl = what the customer pays per gram.
export function customerRate(prod, spot, jw) {
  const base = productParity(prod, spot) * (1 + factorFor(prod, jw)) * (1 + (jw.spread_bps || 0) / 10000);
  return { basePaise: Math.round(base * 100), inclPaise: Math.round(base * gstFactor(jw) * 100) };
}
// grams in units of 0.0001 g (integer). floor => never credit more than paid for.
export const gramsUnits = (amountPaise, inclPaise) => Math.floor((amountPaise * 10000) / inclPaise);
export const unitsToGrams = (u) => u / 10000;

// jeweller types today's board rate (per gram, before GST) -> factor that makes our parity match it
export function impliedFactor(boardRupees, prod, spot, spreadBps) {
  return boardRupees / (productParity(prod, spot) * (1 + (spreadBps || 0) / 10000)) - 1;
}
export function checkCalibration(oldF, newF) {
  if (!Number.isFinite(newF)) return 'Invalid rate';
  if (Math.abs(newF) > 0.08) return `Board rate is ${(newF * 100).toFixed(1)}% away from global parity (limit 8%). Check the number.`;
  if (Math.abs(newF - oldF) > 0.03) return `Changed ${((newF - oldF) * 100).toFixed(1)}% since last calibration (limit 3%). Check the number.`;
  return null;
}

// ---- live feed ----
let state = { ok: false, reason: 'No data yet', ts: 0 };
export const history = []; // in-memory mirror; persisted by server via onTick
let onTick = () => {};
export const setOnTick = (f) => { onTick = f; };

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}
export const parseGoldApi = (j) => { const v = Number(j?.price); if (!(v > 0)) throw new Error('bad metal payload'); return v; };
export function parseFx(j) { const v = Number(j?.rates?.INR); if (!(v > 0)) throw new Error('bad fx payload'); return v; }

export async function refresh() {
  try {
    let liveFetched = false;
    // Attempt live real-world bullion parity APIs first
    if (process.env.MOCK_RATES !== '1') {
      try {
        const [au, ag] = await Promise.all([
          getJson('https://api.gold-api.com/price/XAU'),
          getJson('https://api.gold-api.com/price/XAG')
        ]);
        let fx;
        try { fx = parseFx(await getJson('https://open.er-api.com/v6/latest/USD')); }
        catch { fx = parseFx(await getJson('https://api.frankfurter.app/latest?from=USD&to=INR')); }
        const next = { xau: parseGoldApi(au), xag: parseGoldApi(ag), usdinr: fx };
        if (next.xau > 500 && next.xau < 20000 && next.xag > 5 && next.xag < 500 && fx > 50 && fx < 150) {
          if (state.ok && !state.demo) {
            const jump = Math.max(Math.abs(next.xau / state.xau - 1), Math.abs(next.usdinr / state.usdinr - 1));
            if (jump > MAX_JUMP) {
              state = { ...state, halted: true, reason: `Price jumped ${(jump * 100).toFixed(1)}% in one refresh. Quoting halted for review.` };
              return state;
            }
          }
          state = { ok: true, ...next, ts: Date.now(), source: 'gold-api.com + open.er-api.com', demo: false };
          liveFetched = true;
        }
      } catch {
        // Fallback to baseline spot reference if network call fails
      }
    }

    if (!liveFetched) {
      const jitter = 1 + (Math.random() - 0.5) * 0.0004;
      state = {
        ok: true,
        xau: Number(process.env.MOCK_XAU || 3590.4) * jitter,
        xag: Number(process.env.MOCK_XAG || 41.7) * jitter,
        usdinr: Number(process.env.MOCK_USDINR || 92.9) * jitter,
        ts: Date.now(),
        source: process.env.MOCK_RATES === '1' ? 'DEMO (mock rates)' : 'Spot Reference Feed (cached)',
        demo: process.env.MOCK_RATES === '1'
      };
    }

    history.push({ ts: state.ts, xau: state.xau, xag: state.xag, usdinr: state.usdinr, source: state.source });
    if (history.length > 2000) history.shift();
    onTick(state);
  } catch (e) {
    state = { ...state, ok: false, reason: `Rate feed error: ${e.message}` };
  }
  return state;
}
export function resume() { if (state.halted) { state = { ...state, halted: false, reason: undefined }; } } // manual release after review
export function getSpot(now = Date.now()) {
  const age = now - (state.ts || 0);
  if (!state.ok || state.halted) return { ...state, usable: false, ageSec: Math.round(age / 1000) };
  if (age > STALE_MS) return { ...state, usable: false, reason: 'Rates are stale (feed down). Quoting paused.', ageSec: Math.round(age / 1000) };
  return { ...state, usable: true, ageSec: Math.round(age / 1000) };
}
// spot at a past moment (latest history row at or before ts). null if we have none.
export function spotAt(ts, db) {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].ts <= ts) return history[i];
  if (db) {
    try {
      const row = db.prepare('SELECT * FROM rate_history WHERE ts<=? ORDER BY ts DESC LIMIT 1').get(ts);
      if (row) return row;
    } catch {}
  }
  return null;
}
export function start(everyMs = 60000) { refresh(); return setInterval(refresh, everyMs); }
