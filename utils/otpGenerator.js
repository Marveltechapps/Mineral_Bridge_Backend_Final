const crypto = require('crypto');

/**
 * Generate a cryptographically secure numeric OTP.
 * Uses crypto.randomInt (Node 14.10+) for uniform distribution.
 */
function generateSecureOTP(length = 6) {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length);
  if (typeof crypto.randomInt === 'function') {
    return String(crypto.randomInt(min, max));
  }
  const range = max - min;
  const bytesNeeded = Math.ceil(Math.log2(range) / 8);
  const randomBytes = crypto.randomBytes(bytesNeeded);
  const value = randomBytes.readUIntBE(0, bytesNeeded);
  return String(min + (value % range));
}

module.exports = { generateSecureOTP };
