const path = require('path');
const fs = require('fs');
const { sendOtpSmsOnly, sendOtpWhatsAppOnly } = require('./twilio-otp.service');

const SMS_MESSAGE_TEMPLATE =
  process.env.OTP_SMS_MESSAGE ||
  'Mineral Bridge: Your login code is %s. Valid for 5 minutes.';

function isTruthyEnv(name) {
  return ['1', 'true', 'yes'].includes(String(process.env[name] || '').trim().toLowerCase());
}

function isProductionNodeEnv() {
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production';
}

function isIndiaDialCode(dial) {
  const norm = String(dial || '').replace(/\s/g, '');
  return norm === '+91' || norm === '91';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + '***' + phone.slice(-2);
}

function loadSmsVendorUrl() {
  if (process.env.SMS_VENDOR_URL) return process.env.SMS_VENDOR_URL;
  if (process.env.smsvendor) return process.env.smsvendor;

  const paths = [
    path.join(__dirname, '..', '..', 'config (2).json'),
    path.join(__dirname, '..', '..', 'config.json'),
    path.join(__dirname, '..', 'config.json'),
    path.join(__dirname, '..', 'config', 'config.json'),
  ];
  for (const configPath of paths) {
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config && config.smsvendor) {
          console.log('[OTP] Loaded smsvendor from', configPath);
          return config.smsvendor;
        }
      }
    } catch (_) {
      /* ignore invalid config */
    }
  }
  return '';
}

const SMS_VENDOR_URL = loadSmsVendorUrl();

function hasSmsGateway() {
  return !!(SMS_VENDOR_URL || loadSmsVendorUrl());
}

function hasTwilioSms() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_FROM);
}

function hasTwilioWhatsApp() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM);
}

/** Dev-only OTP when real SMS/WhatsApp delivery is unavailable or failed. */
function allowDevLocalFallback({ afterDeliveryFailure = false } = {}) {
  if (isProductionNodeEnv()) return false;
  if (afterDeliveryFailure || isTruthyEnv('OTP_ALLOW_DEV_LOCAL_FALLBACK')) return true;
  return !hasSmsGateway() && !hasTwilioSms() && !hasTwilioWhatsApp();
}

if (!isProductionNodeEnv()) {
  console.log('[OTP] SMS gateway:', hasSmsGateway() ? 'configured' : 'NOT configured — set SMS_VENDOR_URL or config/config.json');
} else if (!hasSmsGateway() && !hasTwilioSms()) {
  console.error(
    '[OTP] WARNING: production API has no India SMS gateway (SMS_VENDOR_URL) and no Twilio SMS — phone OTP will fail for most users.'
  );
}

function isCampaignGatewayResponse(text) {
  const lower = String(text || '').toLowerCase();
  return lower.includes('campaign') && (lower.includes('success') || lower.includes('sent'));
}

function allowCampaignGatewaySuccess() {
  return isTruthyEnv('SMS_GATEWAY_ACCEPT_CAMPAIGN');
}

function buildSmsMessage(otp) {
  return SMS_MESSAGE_TEMPLATE.replace(/\{otp\}/gi, otp).replace(/%s/g, otp);
}

function normalizeIndiaMobile(digits) {
  let toNumber = String(digits || '').replace(/\D/g, '');
  if (toNumber.length === 12 && toNumber.startsWith('91')) {
    toNumber = toNumber.slice(2);
  }
  return toNumber;
}

async function sendLegacyIndiaSms(digits, otp) {
  const gatewayUrl = SMS_VENDOR_URL || loadSmsVendorUrl();
  if (!gatewayUrl) {
    if (!isProductionNodeEnv()) {
      console.log('[OTP] No SMS gateway; OTP for', maskPhone(digits), ':', otp);
    }
    return { ok: false, reason: 'gateway_not_configured' };
  }

  const toNumber = normalizeIndiaMobile(digits);
  if (toNumber.length !== 10) {
    console.error('[OTP] India SMS gateway requires a 10-digit mobile number, got length', toNumber.length);
    return { ok: false, reason: 'invalid_india_number' };
  }

  const message = buildSmsMessage(otp);
  console.log('[OTP] Sending SMS to', maskPhone(toNumber), '| msg:', message);

  const url = `${gatewayUrl}to_mobileno=${encodeURIComponent(toNumber)}&sms_text=${encodeURIComponent(message)}`;

  try {
    const res = await fetch(url, { method: 'GET' });
    const text = await res.text();
    console.log('[OTP] Gateway response:', res.status, '| body:', String(text).slice(0, 500));

    try {
      const json = JSON.parse(text);
      if (json.status === 'success') {
        if (isCampaignGatewayResponse(text) && !allowCampaignGatewaySuccess()) {
          console.error(
            '[OTP] India gateway accepted the request on a promotional/campaign route (SMS usually will not arrive). ' +
              'Ask Spear UC for transactional OTP route, verify TWILIO_* for fallback, or set SMS_GATEWAY_ACCEPT_CAMPAIGN=1 to ignore.'
          );
          return { ok: false, reason: 'gateway_campaign_route', response: text };
        }
        return { ok: true, channel: 'sms_gateway' };
      }
    } catch (_) {
      /* not JSON */
    }

    const lower = text.toLowerCase();
    if (isCampaignGatewayResponse(text) && !allowCampaignGatewaySuccess()) {
      console.error(
        '[OTP] India gateway accepted the request on a promotional/campaign route (SMS usually will not arrive). ' +
          'Ask Spear UC for transactional OTP route, verify TWILIO_* for fallback, or set SMS_GATEWAY_ACCEPT_CAMPAIGN=1 to ignore.'
      );
      return { ok: false, reason: 'gateway_campaign_route', response: text };
    }

    if (lower.includes('success') || lower.includes('sent')) {
      return { ok: true, channel: 'sms_gateway' };
    }

    console.error('[OTP] SMS gateway rejected message. Response:', text);
    return { ok: false, reason: 'gateway_rejected', response: text };
  } catch (err) {
    console.error('[OTP] Gateway fetch error:', err.message);
    return { ok: false, reason: 'gateway_error', error: err };
  }
}

/**
 * Deliver OTP to a phone number.
 * India (+91) SMS: legacy gateway first (DLT), then Twilio.
 * Other countries SMS: Twilio, then fail (or dev_local only when no providers configured).
 */
async function deliverPhoneOtp({ dial, digits, otp, preferredChannel }) {
  const ch = String(preferredChannel || 'sms').toLowerCase();

  if (ch === 'sms') {
    if (isIndiaDialCode(dial)) {
      const legacy = await sendLegacyIndiaSms(digits, otp);
      if (legacy.ok) {
        return { ok: true, channel: legacy.channel || 'sms_gateway', provider: 'legacy_gateway' };
      }
      if (hasTwilioSms()) {
        const twSms = await sendOtpSmsOnly({ dial, digits, otp, appName: 'Mineral Bridge' }).catch((e) => ({
          ok: false,
          error: e,
        }));
        if (twSms?.ok) return { ok: true, channel: twSms.channel || 'sms', provider: 'twilio' };
        if (twSms?.error) {
          console.warn('[OTP] Twilio SMS failed after India gateway:', twSms.error?.message || twSms.error);
        }
      }
      if (allowDevLocalFallback({ afterDeliveryFailure: true })) {
        console.warn('[OTP] SMS providers failed; OTP issued for local testing only.');
        return { ok: true, channel: 'dev_local', provider: 'dev' };
      }
      return { ok: false, reason: legacy.reason || 'sms_delivery' };
    }

    if (hasTwilioSms()) {
      const twSms = await sendOtpSmsOnly({ dial, digits, otp, appName: 'Mineral Bridge' }).catch((e) => ({
        ok: false,
        error: e,
      }));
      if (twSms?.ok) return { ok: true, channel: twSms.channel || 'sms', provider: 'twilio' };
      if (twSms?.error) {
        console.warn('[OTP] Twilio SMS failed:', twSms.error?.message || twSms.error);
      }
    }

    if (allowDevLocalFallback({ afterDeliveryFailure: true })) {
      console.warn('[OTP] International SMS without working provider; OTP issued for local testing only.');
      return { ok: true, channel: 'dev_local', provider: 'dev' };
    }
    return { ok: false, reason: 'international_sms_requires_twilio' };
  }

  if (hasTwilioWhatsApp()) {
    const twWa = await sendOtpWhatsAppOnly({ dial, digits, otp, appName: 'Mineral Bridge' }).catch((e) => ({
      ok: false,
      error: e,
    }));
    if (twWa?.ok) return { ok: true, channel: twWa.channel || 'whatsapp', provider: 'twilio' };
    if (twWa?.error) {
      console.warn('[OTP] Twilio WhatsApp failed:', twWa.error?.message || twWa.error);
    }
  }

  if (isIndiaDialCode(dial) && hasSmsGateway()) {
    const legacy = await sendLegacyIndiaSms(digits, otp);
    if (legacy.ok) {
      return {
        ok: true,
        channel: legacy.channel || 'sms_gateway',
        provider: 'legacy_gateway',
        fallbackFrom: 'whatsapp',
      };
    }
  }

  if (allowDevLocalFallback({ afterDeliveryFailure: true })) {
    console.warn('[OTP] WhatsApp delivery failed; OTP issued for local testing only.');
    return { ok: true, channel: 'dev_local', provider: 'dev' };
  }

  return { ok: false, reason: 'whatsapp_delivery_failed' };
}

function deliveryFailureMessage(reason) {
  switch (reason) {
    case 'whatsapp_delivery_failed':
      return 'WhatsApp OTP could not be sent. If using Twilio sandbox, open WhatsApp and send the join code to +1 415 523 8886 first, then try again. Otherwise confirm TWILIO_WHATSAPP_FROM is set for your WhatsApp sender.';
    case 'international_sms_requires_twilio':
      return 'SMS to this country requires Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_FROM). Try WhatsApp or Email login.';
    case 'gateway_campaign_route':
      return 'SMS was queued on a promotional route and may not arrive. For local testing, verify your number in Twilio Console (trial accounts) or ask Spear UC to enable transactional OTP for sender EVOLGN. You can also use Email login.';
    case 'gateway_rejected':
    case 'gateway_error':
    case 'sms_delivery':
      return 'SMS could not be sent. Configure Twilio SMS or set OTP_SMS_MESSAGE to your DLT-approved template (see docs/SMS_GET_OTP_ON_DEVICE.md). Try WhatsApp or Email login.';
    default:
      return 'SMS or WhatsApp could not be delivered. Set Twilio env vars (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_FROM and/or TWILIO_WHATSAPP_FROM), use Email login, or configure the India SMS gateway.';
  }
}

/**
 * Include OTP in API JSON for dev/QA only (never for real users in production unless explicitly enabled).
 */
function shouldIncludeOtpInResponse({ dial, digits, channel }) {
  if (!isProductionNodeEnv()) return true;
  if (isTruthyEnv('OTP_INCLUDE_IN_RESPONSE') || isTruthyEnv('OTP_PHONE_DEV_LOG')) return true;

  const testPhone = String(process.env.OTP_TEST_PHONE || '').replace(/\D/g, '');
  const testDigits = String(digits || '').replace(/\D/g, '');
  if (testPhone && testDigits && testPhone === testDigits) return true;

  return channel === 'dev_local';
}

function deliveryWarningForChannel(channel, preferredChannel) {
  if (channel === 'dev_local') {
    return 'OTP was not sent by SMS/WhatsApp (no provider available). Use the code shown below or check the server log.';
  }
  if (channel === 'sms_gateway') {
    return 'SMS was submitted to the India gateway. Delivery can take up to a minute. If you do not receive it, try Email login.';
  }
  return null;
}

function buildPhoneOtpSuccessPayload({
  otp,
  channel,
  expiresInMinutes = 5,
  dial,
  digits,
  preferredChannel,
}) {
  const payload = {
    message: 'OTP sent successfully',
    channel,
    expiresInSeconds: expiresInMinutes * 60,
  };
  const warning = deliveryWarningForChannel(channel, preferredChannel);
  if (warning) payload.deliveryWarning = warning;
  if (shouldIncludeOtpInResponse({ dial, digits, channel })) {
    payload.otp = otp;
  }
  return payload;
}

module.exports = {
  SMS_VENDOR_URL,
  deliverPhoneOtp,
  deliveryFailureMessage,
  buildPhoneOtpSuccessPayload,
  shouldIncludeOtpInResponse,
  isIndiaDialCode,
  loadSmsVendorUrl,
  hasSmsGateway,
};
