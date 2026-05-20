const { hashOTP, compareOTP } = require('../../utils/hash');

describe('Hash Utilities', () => {
  describe('hashOTP', () => {
    it('returns a 64-char hex string', () => {
      const hash = hashOTP('123456');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns the same hash for the same input', () => {
      expect(hashOTP('999999')).toBe(hashOTP('999999'));
    });

    it('returns different hashes for different inputs', () => {
      expect(hashOTP('111111')).not.toBe(hashOTP('222222'));
    });

    it('handles numeric input', () => {
      const hash = hashOTP(123456);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('compareOTP', () => {
    it('returns true for matching OTP', () => {
      const hashed = hashOTP('654321');
      expect(compareOTP('654321', hashed)).toBe(true);
    });

    it('returns false for non-matching OTP', () => {
      const hashed = hashOTP('654321');
      expect(compareOTP('000000', hashed)).toBe(false);
    });

    it('returns false for invalid hash format', () => {
      expect(compareOTP('123456', 'not-a-valid-hex')).toBe(false);
    });

    it('returns false for empty inputs', () => {
      expect(compareOTP('', '')).toBe(false);
    });
  });
});
