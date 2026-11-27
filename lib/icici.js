import crypto from 'node:crypto';

const UAT_DEFAULTS = {
  merchantId: '100000000007164',
  aggregatorId: 'A100000000007164',
  secretKey: 'db06cca0-838b-4e01-8b20-6ac446ffb6bd',
  initiateSaleUrl: 'https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale',
  statusUrl: 'https://pgpayuat.icicibank.com/tsp/pg/api/command',
  refundUrl: 'https://pgpayuat.icicibank.com/tsp/pg/api/command',
};

const LIVE_DEFAULTS = {
  merchantId: process.env.ICICI_LIVE_MERCHANT_ID || '',
  aggregatorId: process.env.ICICI_LIVE_AGGREGATOR_ID || '',
  secretKey: process.env.ICICI_LIVE_SECRET_KEY || '',
  initiateSaleUrl: 'https://pgpay.icicibank.com/pg/api/v2/initiateSale',
  statusUrl: 'https://pgpay.icicibank.com/pg/api/command',
  refundUrl: 'https://pgpay.icicibank.com/pg/api/command',
};

export function getIciciConfig(env = process.env.ICICI_ENV || 'UAT') {
  const isLive = String(env).toUpperCase() === 'LIVE';
  const base = isLive ? LIVE_DEFAULTS : UAT_DEFAULTS;
  return {
    isLive,
    merchantId: process.env.ICICI_MERCHANT_ID || base.merchantId,
    aggregatorId: process.env.ICICI_AGGREGATOR_ID || base.aggregatorId,
    secretKey: process.env.ICICI_SECRET_KEY || base.secretKey,
    initiateSaleUrl: process.env.ICICI_API_INITIATE_SALE || base.initiateSaleUrl,
    statusUrl: process.env.ICICI_API_STATUS || base.statusUrl,
    refundUrl: process.env.ICICI_API_REFUND || base.refundUrl,
    returnUrl: process.env.ICICI_RETURN_URL || 'https://aurum-7c7j.onrender.com/api/payments/icici/response',
  };
}

export function hmacSha256(data, secretKey) {
  return crypto.createHmac('sha256', secretKey).update(data, 'utf8').digest('hex');
}

export function formatNowKolkata() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const p = {};
  for (const { type, value } of parts) p[type] = value;
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
}

const nvl = (s) => (s == null ? '' : String(s).trim());

/**
 * Initiates an ICICI PG transaction (UPI / NetBanking / Cards)
 */
export async function initiateIciciSale({
  amount,
  transactionId,
  customerName = 'Aurum Customer',
  customerMobile = '9999999999',
  customerEmail = 'customer@aurum.local',
  returnUrl,
  env = 'UAT',
  udf1 = '',
  udf2 = '',
  udf3 = '',
}) {
  const cfg = getIciciConfig(env);
  const txnDate = formatNowKolkata();
  const formattedAmount = Number(amount).toFixed(2);
  const rUrl = returnUrl || cfg.returnUrl;

  const fields = {
    addlParam1: '',
    addlParam2: '',
    aggregatorID: cfg.aggregatorId,
    amount: formattedAmount,
    currencyCode: '356', // INR
    customerEmailID: nvl(customerEmail),
    customerMobileNo: nvl(customerMobile),
    customerName: nvl(customerName),
    merchantId: cfg.merchantId,
    merchantTxnNo: nvl(transactionId),
    payType: '0',
    returnURL: rUrl,
    transactionType: 'SALE',
    txnDate,
  };

  let udfFields = null;
  if (udf1 || udf2 || udf3) {
    udfFields = [{ udf21: nvl(udf1), udf22: nvl(udf2), udf23: nvl(udf3) }];
    fields.udfFields = udfFields;
  }

  const sortedKeys = Object.keys(fields).sort();
  let dataToHash = '';
  for (const k of sortedKeys) {
    if (k === 'udfFields' && udfFields) {
      dataToHash += JSON.stringify(udfFields);
    } else {
      dataToHash += fields[k];
    }
  }

  const secureHash = hmacSha256(dataToHash, cfg.secretKey);
  const payload = {};
  for (const k of sortedKeys) payload[k] = fields[k];
  payload.secureHash = secureHash;

  try {
    const res = await fetch(cfg.initiateSaleUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    const rawResponse = await res.json();
    let redirectUrl = null;
    if (rawResponse && rawResponse.redirectURI && rawResponse.tranCtx) {
      redirectUrl = `${rawResponse.redirectURI}?tranCtx=${rawResponse.tranCtx}`;
    }

    return {
      success: !!redirectUrl,
      redirectUrl,
      rawResponse,
      transactionId,
      txnDate,
      payload,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      transactionId,
      txnDate,
      payload,
    };
  }
}

/**
 * Checks ICICI Transaction Status via command API
 */
export async function checkIciciStatus({
  transactionId,
  originalId,
  env = 'UAT',
}) {
  const cfg = getIciciConfig(env);
  const data = {
    aggregatorID: cfg.aggregatorId,
    merchantId: cfg.merchantId,
    merchantTxnNo: nvl(transactionId),
    originalTxnNo: nvl(originalId || transactionId),
    transactionType: 'STATUS',
  };

  const dataToHash = Object.keys(data).sort().map((k) => data[k]).join('');
  const secureHash = hmacSha256(dataToHash, cfg.secretKey);
  const payload = { ...data, secureHash };

  try {
    const res = await fetch(cfg.statusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    const rawResponse = await res.json();
    return { success: true, data: rawResponse };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Initiates an ICICI Refund
 */
export async function initiateIciciRefund({
  transactionId,
  originalId,
  amount,
  env = 'UAT',
}) {
  const cfg = getIciciConfig(env);
  const formattedAmount = Number(amount).toFixed(2);
  const data = {
    aggregatorID: cfg.aggregatorId,
    amount: formattedAmount,
    merchantId: cfg.merchantId,
    merchantTxnNo: nvl(transactionId),
    originalTxnNo: nvl(originalId),
    transactionType: 'REFUND',
  };

  const dataToHash = Object.keys(data).sort().map((k) => data[k]).join('');
  const secureHash = hmacSha256(dataToHash, cfg.secretKey);
  const payload = { ...data, secureHash };

  try {
    const res = await fetch(cfg.refundUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    const rawResponse = await res.json();
    return { success: true, data: rawResponse, amount: formattedAmount };
  } catch (err) {
    return { success: false, error: err.message, amount: formattedAmount };
  }
}
