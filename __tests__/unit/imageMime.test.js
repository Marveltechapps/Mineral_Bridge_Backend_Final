const { isAllowedImageMime, normalizeImageContentType } = require('../../lib/imageMime');

describe('imageMime', () => {
  describe('isAllowedImageMime', () => {
    it('accepts standard image types', () => {
      expect(isAllowedImageMime('image/jpeg')).toBe(true);
      expect(isAllowedImageMime('image/png')).toBe(true);
      expect(isAllowedImageMime('image/webp')).toBe(true);
    });

    it('accepts iOS HEIC and octet-stream with image extension', () => {
      expect(isAllowedImageMime('image/heic')).toBe(true);
      expect(isAllowedImageMime('image/heif')).toBe(true);
      expect(isAllowedImageMime('application/octet-stream', 'avatar.heic')).toBe(true);
      expect(isAllowedImageMime('application/octet-stream', 'avatar.jpg')).toBe(true);
    });

    it('rejects non-image types', () => {
      expect(isAllowedImageMime('application/pdf')).toBe(false);
      expect(isAllowedImageMime('text/plain')).toBe(false);
    });
  });

  describe('normalizeImageContentType', () => {
    it('normalizes aliases and infers from filename', () => {
      expect(normalizeImageContentType('image/jpg')).toBe('image/jpeg');
      expect(normalizeImageContentType('application/octet-stream', 'avatar.heic')).toBe('image/heic');
      expect(normalizeImageContentType('', 'photo.jpeg')).toBe('image/jpeg');
    });
  });
});
