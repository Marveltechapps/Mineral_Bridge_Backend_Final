const { generateAccessToken, generateRefreshToken, verifyToken } = require('../../services/jwt.service');

describe('JWT Service', () => {
  const testPayload = { userId: '507f1f77bcf86cd799439011', phone: '+911234567890' };

  describe('generateAccessToken', () => {
    it('returns a JWT string', () => {
      const token = generateAccessToken(testPayload);
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('contains the correct payload when decoded', () => {
      const token = generateAccessToken(testPayload);
      const decoded = verifyToken(token);
      expect(decoded.userId).toBe(testPayload.userId);
      expect(decoded.phone).toBe(testPayload.phone);
    });

    it('includes an expiration claim', () => {
      const token = generateAccessToken(testPayload);
      const decoded = verifyToken(token);
      expect(decoded.exp).toBeDefined();
      expect(decoded.iat).toBeDefined();
    });
  });

  describe('generateRefreshToken', () => {
    it('returns a token and tokenId', () => {
      const result = generateRefreshToken(testPayload);
      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('tokenId');
      expect(typeof result.token).toBe('string');
      expect(typeof result.tokenId).toBe('string');
    });

    it('includes type=refresh in the token payload', () => {
      const { token } = generateRefreshToken(testPayload);
      const decoded = verifyToken(token);
      expect(decoded.type).toBe('refresh');
    });

    it('includes a unique jti claim', () => {
      const { token } = generateRefreshToken(testPayload);
      const decoded = verifyToken(token);
      expect(decoded.jti).toBeDefined();
      expect(decoded.jti.length).toBe(32);
    });

    it('generates different tokenIds each time', () => {
      const r1 = generateRefreshToken(testPayload);
      const r2 = generateRefreshToken(testPayload);
      expect(r1.tokenId).not.toBe(r2.tokenId);
    });
  });

  describe('verifyToken', () => {
    it('verifies a valid token', () => {
      const token = generateAccessToken(testPayload);
      const decoded = verifyToken(token);
      expect(decoded.userId).toBe(testPayload.userId);
    });

    it('throws on invalid token', () => {
      expect(() => verifyToken('invalid.token.here')).toThrow();
    });

    it('throws on tampered token', () => {
      const token = generateAccessToken(testPayload);
      const tampered = token.slice(0, -5) + 'XXXXX';
      expect(() => verifyToken(tampered)).toThrow();
    });
  });
});
