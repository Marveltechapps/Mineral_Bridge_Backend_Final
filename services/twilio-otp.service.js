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
    const body = `${appName}: Your login code is ${otp}. Expires in 5 minutes.`;
    const msg = await sendViaSms({ toE164, body });
    return { ok: true, channel: 'sms', messageSid: msg?.sid || null, toE164 };
  } catch (err) {
    return { ok: false, error: err };
  }
}

/**
 * WhatsApp-first OTP delivery with fallback.
 * Returns { ok, channel, messageSid? } where channel is "whatsapp" or "sms".
 */
async function sendOtpWhatsAppFirst({ dial, digits, otp, appName = 'Mineral Bridge' }) {
  const toE164 = buildE164(dial, digits);
  const waBody = `${appName}: Your login code is ${otp}. It expires in 5 minutes. Do not share this code.`;
  const smsBody = `${appName}: Your login code is ${otp}. Expires in 5 minutes.`;

  // Try WhatsApp first
  try {
    const msg = await sendViaWhatsApp({ toE164, body: waBody });
    return { ok: true, channel: 'whatsapp', messageSid: msg?.sid || null, toE164 };
  } catch (err) {
    // Fall back to SMS if configured
    if (process.env.TWILIO_SMS_FROM) {
      const msg = await sendViaSms({ toE164, body: smsBody });
      return { ok: true, channel: 'sms', messageSid: msg?.sid || null, toE164 };
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
  sendOtpWhatsAppFirst,
  sendUserSmsMessage,
  sendUserWhatsAppMessage,
};

