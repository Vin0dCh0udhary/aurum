import crypto from 'node:crypto';

// UPI AutoPay & Payment Gateway Webhook Adapter
// Jeweller-owned merchant accounts (Razorpay / Cashfree)
// Money flows directly to the jeweller's own merchant settlement account (zero platform custody).

export function verifyWebhookSignature({ provider, headers, rawBody, secret }) {
  if (!secret) return false;
  const p = String(provider || '').toLowerCase();

  if (p === 'razorpay') {
    const signature = headers['x-razorpay-signature'];
    if (!signature) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  if (p === 'cashfree') {
    const signature = headers['x-webhook-signature'];
    const timestamp = headers['x-webhook-timestamp'];
    if (!signature || !timestamp) return false;
    const signedPayload = `${timestamp}${rawBody}`;
    const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('base64');
    return signature === expected;
  }

  if (p === 'mock') {
    return headers['x-mock-signature'] === 'valid_mock_signature';
  }

  return false;
}

// Parse incoming webhook payload into unified schema:
// { event: 'PAYMENT_SUCCESS'|'MANDATE_ACTIVE'|'PAYMENT_FAILED', paymentRef, utr, amountPaise, mandateId }
export function parseGatewayWebhook({ provider, body }) {
  const p = String(provider || '').toLowerCase();
  const j = typeof body === 'string' ? JSON.parse(body) : body;

  if (p === 'razorpay') {
    const event = j.event;
    if (event === 'payment.captured' || event === 'subscription.charged') {
      const pay = j.payload?.payment?.entity;
      return {
        event: 'PAYMENT_SUCCESS',
        paymentRef: pay?.notes?.payment_ref || pay?.description,
        enrolmentId: Number(pay?.notes?.enrolment_id || 0),
        utr: pay?.acquirer_data?.rrn || pay?.acquirer_data?.upi_transaction_id || `RZP${pay?.id?.slice(-8)}`,
        amountPaise: Math.round(Number(pay?.amount || 0)), // RZP amounts are already in paise
        gatewayPaymentId: pay?.id,
        mandateId: pay?.subscription_id || pay?.order_id,
      };
    }
    if (event === 'subscription.activated') {
      const sub = j.payload?.subscription?.entity;
      return {
        event: 'MANDATE_ACTIVE',
        enrolmentId: Number(sub?.notes?.enrolment_id || 0),
        mandateId: sub?.id,
      };
    }
  }

  if (p === 'cashfree') {
    const type = j.type;
    if (type === 'SUBSCRIPTION_PAYMENT_SUCCESS' || type === 'PAYMENT_SUCCESS_WEBHOOK') {
      const data = j.data;
      const order = data?.order || data;
      const payment = data?.payment || data;
      return {
        event: 'PAYMENT_SUCCESS',
        paymentRef: order?.order_tags?.payment_ref || order?.order_id,
        enrolmentId: Number(order?.order_tags?.enrolment_id || 0),
        utr: payment?.bank_reference || payment?.payment_gateway_details?.bank_reference || `CF${payment?.cf_payment_id || Date.now()}`,
        amountPaise: Math.round(Number(payment?.payment_amount || order?.order_amount || 0) * 100),
        gatewayPaymentId: String(payment?.cf_payment_id || order?.order_id),
        mandateId: data?.subscription?.subscription_id,
      };
    }
    if (type === 'SUBSCRIPTION_ACTIVE') {
      return {
        event: 'MANDATE_ACTIVE',
        enrolmentId: Number(j.data?.subscription?.subscription_tags?.enrolment_id || 0),
        mandateId: j.data?.subscription?.subscription_id,
      };
    }
  }

  if (p === 'mock') {
    return {
      event: j.event || 'PAYMENT_SUCCESS',
      paymentRef: j.paymentRef,
      enrolmentId: Number(j.enrolmentId || 0),
      utr: j.utr || 'MOCKUTR' + Date.now(),
      amountPaise: Number(j.amountPaise || 0),
      gatewayPaymentId: j.gatewayPaymentId || 'MOCKPAY' + Date.now(),
      mandateId: j.mandateId,
    };
  }

  return null;
}

// Create an AutoPay mandate / subscription session
export async function createAutoPayMandate({ provider, creds, enrolment, customer, jeweller }) {
  const p = String(provider || 'mock').toLowerCase();

  if (p === 'mock') {
    const mandateId = 'sub_mock_' + crypto.randomBytes(6).toString('hex');
    const authUrl = `https://mock-gateway.local/autopay/${mandateId}`;
    return {
      ok: true,
      mandateId,
      authUrl,
      mode: 'mock',
    };
  }

  if (p === 'razorpay') {
    // Razorpay Subscriptions API: POST /v1/subscriptions
    const keyId = creds.key_id;
    const keySecret = creds.key_secret;
    const planId = creds.plan_id;
    if (!keyId || !keySecret) throw new Error('Razorpay credentials missing in jeweller setup');

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/subscriptions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        plan_id: planId,
        total_count: 11, // 11-month tenure
        quantity: 1,
        customer_notify: 1,
        notes: {
          enrolment_id: String(enrolment.id),
          customer_phone: customer.phone,
          shop_name: jeweller.shop_name,
        },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.description || 'Failed to create Razorpay AutoPay mandate');
    return {
      ok: true,
      mandateId: data.id,
      authUrl: data.short_url,
    };
  }

  if (p === 'cashfree') {
    // Cashfree Subscriptions API: POST /pg/orders or /subscription
    const appId = creds.app_id;
    const secret = creds.secret_key;
    if (!appId || !secret) throw new Error('Cashfree credentials missing in jeweller setup');

    const res = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-client-id': appId,
        'x-client-secret': secret,
        'x-api-version': '2023-08-01',
      },
      body: JSON.stringify({
        order_amount: enrolment.instalment_paise / 100,
        order_currency: 'INR',
        customer_details: {
          customer_id: `cust_${customer.id}`,
          customer_phone: customer.phone,
          customer_name: customer.name || 'Customer',
        },
        order_tags: {
          enrolment_id: String(enrolment.id),
          autopay: 'true',
        },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to initiate Cashfree mandate');
    return {
      ok: true,
      mandateId: data.cf_order_id,
      authUrl: data.payment_link,
    };
  }

  throw new Error(`Unsupported gateway provider: ${provider}`);
}
