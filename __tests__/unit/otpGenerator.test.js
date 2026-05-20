const { generateSecureOTP } = require('../../utils/otpGenerator');

describe('OTP Generator', () => {
  it('generates a 6-digit OTP by default', () => {
    const otp = generateSecureOTP();
    expect(otp).toMatch(/^\d{6}$/);
    expect(Number(otp)).toBeGreaterThanOrEqual(100000);
    expect(Number(otp)).toBeLessThan(1000000);
  });

  it('generates a 4-digit OTP when length=4', () => {
    const otp = generateSecureOTP(4);
    expect(otp).toMatch(/^\d{4}$/);
    expect(Number(otp)).toBeGreaterThanOrEqual(1000);
    expect(Number(otp)).toBeLessThan(10000);
  });

  it('generates a 8-digit OTP when length=8', () => {
    const otp = generateSecureOTP(8);
    expect(otp).toMatch(/^\d{8}$/);
  });

  it('returns a string', () => {
    expect(typeof generateSecureOTP()).toBe('string');
  });

  it('generates different OTPs on successive calls', () => {
    const otps = new Set();
    for (let i = 0; i < 50; i++) otps.add(generateSecureOTP());
    expect(otps.size).toBeGreaterThan(1);
  });
});
