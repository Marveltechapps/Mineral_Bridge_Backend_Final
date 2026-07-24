const {
  isIndiaDialCode,
  deliveryFailureMessage,
  shouldIncludeOtpInResponse,
  buildPhoneOtpSuccessPayload,
} = require('../../services/phone-otp-delivery.service');

describe('phone-otp-delivery.service', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('isIndiaDialCode', () => {
    it('recognizes +91', () => {
      expect(isIndiaDialCode('+91')).toBe(true);
      expect(isIndiaDialCode('91')).toBe(true);
      expect(isIndiaDialCode('+233')).toBe(false);
    });
  });

  describe('deliveryFailureMessage', () => {
    it('returns Twilio hint for international SMS', () => {
      expect(deliveryFailureMessage('international_sms_requires_twilio')).toMatch(/Twilio/i);
    });

    it('returns campaign-route hint for gateway campaign failures', () => {
      expect(deliveryFailureMessage('gateway_campaign_route')).toMatch(/transactional|Twilio/i);
    });

    it('returns DLT hint for gateway failures', () => {
      expect(deliveryFailureMessage('sms_delivery')).toMatch(/DLT/i);
    });
  });

  describe('shouldIncludeOtpInResponse', () => {
    it('includes OTP in development', () => {
      process.env.NODE_ENV = 'development';
      expect(shouldIncludeOtpInResponse({ dial: '+91', digits: '9876543210', channel: 'sms' })).toBe(true);
    });

    it('hides OTP in production by default', () => {
      process.env.NODE_ENV = 'production';
      expect(shouldIncludeOtpInResponse({ dial: '+91', digits: '9876543210', channel: 'sms_gateway' })).toBe(false);
    });

    it('includes OTP in production when OTP_INCLUDE_IN_RESPONSE=1', () => {
      process.env.NODE_ENV = 'production';
      process.env.OTP_INCLUDE_IN_RESPONSE = '1';
      expect(shouldIncludeOtpInResponse({ dial: '+91', digits: '9876543210', channel: 'sms_gateway' })).toBe(true);
    });
  });

  describe('buildPhoneOtpSuccessPayload', () => {
    it('adds otp field in development', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.OTP_TTL_SECONDS;
      const payload = buildPhoneOtpSuccessPayload({
        otp: '1234',
        channel: 'dev_local',
        dial: '+91',
        digits: '9876543210',
      });
      expect(payload.otp).toBe('1234');
      expect(payload.channel).toBe('dev_local');
      expect(payload.expiresInSeconds).toBe(30);
    });

    it('omits otp field in production unless allowed', () => {
      process.env.NODE_ENV = 'production';
      const payload = buildPhoneOtpSuccessPayload({
        otp: '1234',
        channel: 'sms_gateway',
        dial: '+91',
        digits: '9876543210',
      });
      expect(payload.otp).toBeUndefined();
      expect(payload.message).toBe('OTP sent successfully');
    });
  });
});
