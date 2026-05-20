const crypto = require('crypto');

const SALT = process.env.OTP_HASH_SALT || process.env.JWT_SECRET || 'mineral-bridge-otp-salt';

function hashOTP(otp) {
  return crypto.createHmac('sha256', SALT).update(String(otp)).digest('hex');
}

/**
 * Constant-time comparison to prevent timing attacks.
 * Both arguments must be hex strings of equal length.
 */
function compareOTP(plainOtp, hashedOtp) {
  try {
    const hash = hashOTP(plainOtp);
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(hashedOtp, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

module.exports = { hashOTP, compareOTP };
