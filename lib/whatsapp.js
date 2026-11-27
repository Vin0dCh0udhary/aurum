// WhatsApp Cloud API (Meta) & Notification Adapter
// Mode: mock (default for test/dev) | cloud | none

const dispatches = [];

export function getRecentDispatches() {
  return [...dispatches];
}

export function clearDispatches() {
  dispatches.length = 0;
}

export const formatIndianPhone = (p) => {
  const digits = String(p || '').replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return digits;
};

async function sendCloudMessage({ to, type, template, text }) {
  const mode = process.env.WHATSAPP_PROVIDER || (process.env.META_WA_TOKEN ? 'cloud' : 'mock');
  const recipient = formatIndianPhone(to);
  const payload = {
    messaging_product: 'whatsapp',
    to: recipient,
    type,
    ...(template ? { template } : {}),
    ...(text ? { text: { body: text } } : {}),
  };

  const logEntry = {
    ts: Date.now(),
    to: recipient,
    type,
    content: text || template?.name || 'custom template',
    mode,
  };

  if (mode === 'mock' || mode === 'none') {
    logEntry.status = 'DELIVERED_MOCK';
    logEntry.id = 'wamid.MOCK' + Date.now();
    dispatches.push(logEntry);
    if (dispatches.length > 500) dispatches.shift();
    return { ok: true, id: logEntry.id, mock: true };
  }

  const phoneId = process.env.META_WA_PHONE_NUMBER_ID;
  const token = process.env.META_WA_TOKEN;
  if (!phoneId || !token) {
    throw new Error('Meta WhatsApp Cloud credentials missing (META_WA_PHONE_NUMBER_ID, META_WA_TOKEN)');
  }

  const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    logEntry.status = 'FAILED';
    logEntry.error = data.error?.message || 'Meta API call failed';
    dispatches.push(logEntry);
    throw new Error(`WhatsApp API error: ${logEntry.error}`);
  }

  logEntry.status = 'SENT';
  logEntry.id = data.messages?.[0]?.id;
  dispatches.push(logEntry);
  return { ok: true, id: logEntry.id };
}

// 1. Send OTP for customer/jeweller login
export async function sendOtp(phone, otp) {
  const useTemplate = process.env.META_WA_OTP_TEMPLATE;
  if (useTemplate) {
    return sendCloudMessage({
      to: phone,
      type: 'template',
      template: {
        name: useTemplate,
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: String(otp) }],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: String(otp) }],
          },
        ],
      },
    });
  }
  return sendCloudMessage({
    to: phone,
    type: 'text',
    text: `Your login verification code for Gold & Silver Scheme is: ${otp}. Valid for 10 minutes. Do not share this OTP with anyone.`,
  });
}

// 2. Send missed instalment nudge
export async function sendMissedNudge({ phone, customerName, shopName, missedCount, nextDueDate, instalmentRupees }) {
  const text = `Namaste ${customerName || 'Customer'},\n\nYour instalment of ₹${Number(instalmentRupees).toLocaleString('en-IN')} for your gold scheme with ${shopName} is overdue (${missedCount} instalment(s) missed, due date: ${nextDueDate}).\n\nPlease visit your passbook or the showroom to clear your pending instalment.\n\nThank you,\n${shopName}`;
  return sendCloudMessage({
    to: phone,
    type: 'text',
    text,
  });
}

// 3. Send payment credited alert
export async function sendCreditConfirmation({ phone, customerName, shopName, amountRupees, gramsCredited, totalGrams }) {
  const text = `Namaste ${customerName || 'Customer'},\n\n₹${Number(amountRupees).toLocaleString('en-IN')} received successfully by ${shopName}. Credited +${Number(gramsCredited).toFixed(4)} g to your passbook. Total accumulated: ${Number(totalGrams).toFixed(4)} g.\n\nCheck your live passbook anytime.\n\n${shopName}`;
  return sendCloudMessage({
    to: phone,
    type: 'text',
    text,
  });
}

// 4. Send month-11 maturity prompt
export async function sendMaturityAlert({ phone, customerName, shopName, gramsTotal, maturityDate }) {
  const text = `Congratulations ${customerName || 'Customer'}!\n\nYour gold advance purchase scheme with ${shopName} has matured as of ${maturityDate}. You have ${Number(gramsTotal).toFixed(4)} grams ready for physical redemption against 100% hallmarked jewellery or coins in our showroom.\n\nPlease visit us with your ID before Day 364 to select your jewellery!\n\nWarm regards,\n${shopName}`;
  return sendCloudMessage({
    to: phone,
    type: 'text',
    text,
  });
}
