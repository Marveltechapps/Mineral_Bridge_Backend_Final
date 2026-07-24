const twilio = require('twilio');

function canUseTwilio() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

function normalizeDial(dial) {
  const d = String(dial || '').trim();
  if (!d) return '';
  return d.startsWith('+') ? d : `+${d}`;
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Build an E.164 phone string like "+918925494404" from (dial="+91", digits="8925494404").
 * Handles common "double country code" inputs for +91 and +1 (mirrors getOtpKey logic).
 */
function buildE164(dial, digits) {
  const normDial = normalizeDial(dial) || '+91';
  let d = digitsOnly(digits);
  if (normDial === '+91' && d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (normDial === '+1' && d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return `${normDial}${d}`;
}

function getClient() {
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

function twilioDeliveryError({ errorCode, errorMessage, status }) {
  const code = Number(errorCode);
  const msg = String(errorMessage || '').trim();
  if (code === 21608) {
    return new Error(
      'SMS could not be sent: Twilio trial accounts only deliver to verified numbers. Verify the number in Twilio Console or use the India SMS route.'
    );
  }
  if (code === 63015) {
    return new Error(
      'WhatsApp sandbox: open WhatsApp and send the join code to +1 415 523 8886 first, then try again.'
    );
  }
  if (msg) return new Error(msg);
  return new Error(`Message ${status || 'failed'} via Twilio`);
}

async function fetchTwilioMessageDelivery(messageSid) {
  if (!messageSid || !canUseTwilio()) return { delivered: false, status: 'unknown' };
  const client = getClient();
  const delays = [300, 500, 700, 1000, 1200];
  for (const ms of delays) {
    await new Promise((r) => setTimeout(r, ms));
    const msg = await client.messages(messageSid).fetch();
    if (['delivered', 'sent', 'read'].includes(msg.status)) {
      return { delivered: true, status: msg.status };
    }
    if (['failed', 'undelivered', 'canceled'].includes(msg.status)) {
      return {
        delivered: false,
        status: msg.status,
        errorCode: msg.errorCode,
        errorMessage: msg.errorMessage,
        error: twilioDeliveryError({
          errorCode: msg.errorCode,
          errorMessage: msg.errorMessage,
          status: msg.status,
        }),
      };
    }
  }
  // Still queued — treat as accepted (carrier may deliver shortly).
  return { delivered: true, status: 'accepted' };
}

async function sendViaWhatsApp({ toE164, body }) {
  if (!canUseTwilio()) throw new Error('Twilio not configured');
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!from) throw new Error('TWILIO_WHATSAPP_FROM not set');
  const client = getClient();
  return client.messages.create({
    from,
    to: `whatsapp:${toE164}`,
    body,
  });
}

async function sendViaSms({ toE164, body }) {
  if (!canUseTwilio()) throw new Error('Twilio not configured');
  const from = process.env.TWILIO_SMS_FROM;
  if (!from) throw new Error('TWILIO_SMS_FROM not set');
  const client = getClient();
  return client.messages.create({
    from,
    to: toE164,
    body,
  });
}

async function sendTwilioSmsWithDeliveryCheck({ toE164, body }) {
  const msg = await sendViaSms({ toE164, body });
  const delivery = await fetchTwilioMessageDelivery(msg?.sid);
  if (!delivery.delivered) {
    return { ok: false, error: delivery.error, errorCode: delivery.errorCode, messageSid: msg?.sid || null };
  }
  return { ok: true, channel: 'sms', messageSid: msg?.sid || null, toE164 };
}

/**
 * SMS-only OTP (Twilio). Use for the app's "Mobile / SMS" tab and as fallback for legacy gateways.
 * Returns { ok, channel?, messageSid?, error? }.
 */
async function sendOtpSmsOnly({ dial, digits, otp, appName = 'Mineral Bridge' }) {
  if (!canUseTwilio() || !process.env.TWILIO_SMS_FROM) {
    return { ok: false, error: new Error('Twilio SMS not configured') };
  }
  try {
    const toE164 = buildE164(dial, digits);
    const body = `${appName}: Your login code is ${otp}. Expires in 30 seconds.`;
    return await sendTwilioSmsWithDeliveryCheck({ toE164, body });
  } catch (err) {
    return { ok: false, error: err };
  }
}

/**
 * WhatsApp-only OTP delivery (no SMS fallback). Use when the user explicitly chose WhatsApp login.
 * Returns { ok, channel?, messageSid?, error? }.
 */
async function sendOtpWhatsAppOnly({ dial, digits, otp, appName = 'Mineral Bridge' }) {
  if (!canUseTwilio() || !process.env.TWILIO_WHATSAPP_FROM) {
    return { ok: false, error: new Error('Twilio WhatsApp not configured (TWILIO_WHATSAPP_FROM)') };
  }
  const toE164 = buildE164(dial, digits);
  try {
    console.log('[OTP] Sending WhatsApp OTP to', toE164, 'from', process.env.TWILIO_WHATSAPP_FROM);
    const body = `${appName}: Your login code is ${otp}. It expires in 30 seconds. Do not share this code.`;
    const msg = await sendViaWhatsApp({ toE164, body });
    const delivery = await fetchTwilioMessageDelivery(msg?.sid);
    if (delivery.delivered) {
      return { ok: true, channel: 'whatsapp', messageSid: msg?.sid || null, toE164 };
    }
    const detail = delivery.error || new Error('WhatsApp message could not be delivered');
    console.warn('[OTP] WhatsApp not delivered to', toE164, '| status:', delivery.status, '|', detail.message);
    return {
      ok: false,
      channel: 'whatsapp',
      messageSid: msg?.sid || null,
      toE164,
      error: detail,
    };
  } catch (err) {
    console.warn('[OTP] WhatsApp send exception to', toE164, ':', err.message || err);
    return { ok: false, channel: 'whatsapp', messageSid: null, toE164, error: err };
  }
}

/**
 * WhatsApp-first OTP delivery with SMS fallback when sandbox/delivery fails.
 * Returns { ok, channel, messageSid? } where channel is "whatsapp" or "sms".
 */
async function sendOtpWhatsAppFirst({ dial, digits, otp, appName = 'Mineral Bridge' }) {
  const toE164 = buildE164(dial, digits);
  const waBody = `${appName}: Your login code is ${otp}. It expires in 30 seconds. Do not share this code.`;
  const smsBody = `${appName}: Your login code is ${otp}. Expires in 30 seconds.`;

  try {
    console.log('[OTP] Sending WhatsApp OTP to', toE164, 'from', process.env.TWILIO_WHATSAPP_FROM);
    const msg = await sendViaWhatsApp({ toE164, body: waBody });
    const delivery = await fetchTwilioMessageDelivery(msg?.sid);
    if (delivery.delivered) {
      console.log('[OTP] WhatsApp delivered to', toE164, '| status:', delivery.status);
      return { ok: true, channel: 'whatsapp', messageSid: msg?.sid || null, toE164 };
    }
    console.warn(
      '[OTP] WhatsApp not delivered to',
      toE164,
      '| status:',
      delivery.status,
      '|',
      delivery.error?.message || delivery.errorMessage || 'unknown'
    );
    if (process.env.TWILIO_SMS_FROM) {
      const sms = await sendTwilioSmsWithDeliveryCheck({ toE164, body: smsBody });
      if (sms.ok) {
        return { ...sms, fallbackFrom: 'whatsapp' };
      }
      return { ok: false, channel: 'whatsapp', messageSid: null, toE164, error: sms.error || delivery.error };
    }
    return { ok: false, channel: 'whatsapp', messageSid: null, toE164, error: delivery.error };
  } catch (err) {
    console.warn('[OTP] WhatsApp send exception to', toE164, ':', err.message || err);
    if (process.env.TWILIO_SMS_FROM) {
      try {
        const sms = await sendTwilioSmsWithDeliveryCheck({ toE164, body: smsBody });
        if (sms.ok) return { ...sms, fallbackFrom: 'whatsapp' };
        return { ok: false, channel: 'whatsapp', messageSid: null, toE164, error: sms.error || err };
      } catch (smsErr) {
        return { ok: false, channel: 'whatsapp', messageSid: null, toE164, error: smsErr };
      }
    }
    return { ok: false, channel: 'whatsapp', messageSid: null, toE164, error: err };
  }
}

/**
 * Dashboard outbound message to an app user (not OTP).
 * @returns {{ ok: boolean, channel?: string, messageSid?: string, error?: Error }}
 */
async function sendUserSmsMessage({ phone, countryCode, body }) {
  if (!canUseTwilio() || !process.env.TWILIO_SMS_FROM) {
    return { ok: false, error: new Error('Twilio SMS not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_FROM)') };
  }
  try {
    const toE164 = buildE164(countryCode || '+1', phone);
    const msg = await sendViaSms({ toE164, body: String(body || '').trim() || 'Message from Mineral Bridge.' });
    return { ok: true, channel: 'sms', messageSid: msg?.sid || null, toE164 };
  } catch (err) {
    return { ok: false, error: err };
  }
}

async function sendUserWhatsAppMessage({ phone, countryCode, body }) {
  if (!canUseTwilio() || !process.env.TWILIO_WHATSAPP_FROM) {
    return { ok: false, error: new Error('Twilio WhatsApp not configured (TWILIO_WHATSAPP_FROM)') };
  }
  try {
    const toE164 = buildE164(countryCode || '+1', phone);
    const msg = await sendViaWhatsApp({ toE164, body: String(body || '').trim() || 'Message from Mineral Bridge.' });
    return { ok: true, channel: 'whatsapp', messageSid: msg?.sid || null, toE164 };
  } catch (err) {
    return { ok: false, error: err };
  }
}

module.exports = {
  buildE164,
  sendOtpSmsOnly,
  sendOtpWhatsAppOnly,
  sendOtpWhatsAppFirst,
  sendUserSmsMessage,
  sendUserWhatsAppMessage,
};
