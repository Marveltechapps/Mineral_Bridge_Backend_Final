const { getBucket, s3Url, BUCKET_USER, BUCKET_ADMIN } = require('../../config/s3');

describe('S3 Config Utilities', () => {
  describe('getBucket', () => {
    it('returns user bucket for scope "user"', () => {
      expect(getBucket('user')).toBe(BUCKET_USER);
    });

    it('returns admin bucket for scope "admin"', () => {
      expect(getBucket('admin')).toBe(BUCKET_ADMIN);
    });

    it('defaults to user bucket for undefined scope', () => {
      expect(getBucket(undefined)).toBe(BUCKET_USER);
    });

    it('defaults to user bucket for any non-admin string', () => {
      expect(getBucket('something')).toBe(BUCKET_USER);
    });
  });

  describe('s3Url', () => {
    it('builds a correct S3 URL for user scope', () => {
      const url = s3Url('avatars/123/abc.jpg', 'user');
      expect(url).toBe(`https://${BUCKET_USER}.s3.ap-south-1.amazonaws.com/avatars/123/abc.jpg`);
    });

    it('builds a correct S3 URL for admin scope', () => {
      const url = s3Url('minerals/gold.jpg', 'admin');
      expect(url).toBe(`https://${BUCKET_ADMIN}.s3.ap-south-1.amazonaws.com/minerals/gold.jpg`);
    });

    it('defaults to user scope', () => {
      const url = s3Url('test/file.pdf');
      expect(url).toContain(BUCKET_USER);
    });
  });

  describe('bucket constants', () => {
    it('has BUCKET_USER defined', () => {
      expect(BUCKET_USER).toBeDefined();
      expect(typeof BUCKET_USER).toBe('string');
    });

    it('has BUCKET_ADMIN defined', () => {
      expect(BUCKET_ADMIN).toBeDefined();
      expect(typeof BUCKET_ADMIN).toBe('string');
    });
  });
});
