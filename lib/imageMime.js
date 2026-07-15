const path = require('path');

const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const EXT_TO_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

/**
 * Whether an uploaded avatar/image is allowed (React Native often sends HEIC or application/octet-stream).
 */
function isAllowedImageMime(mimetype, filename = '') {
  const mime = String(mimetype || '').toLowerCase().trim();
  if (ALLOWED_IMAGE_MIMES.has(mime)) return true;
  const octet = !mime || mime === 'application/octet-stream';
  if (octet && /\.(jpe?g|png|webp|heic|heif)$/i.test(filename || '')) return true;
  return false;
}

/**
 * Normalize MIME for S3 Content-Type (e.g. image/jpg → image/jpeg, octet-stream + .heic → image/heic).
 */
function normalizeImageContentType(mimetype, filename = '') {
  const mime = String(mimetype || '').toLowerCase().trim();
  if (mime === 'image/jpg') return 'image/jpeg';
  if (mime === 'image/heif') return 'image/heic';
  if (ALLOWED_IMAGE_MIMES.has(mime)) return mime === 'image/jpg' ? 'image/jpeg' : mime;
  const ext = path.extname(filename || '').toLowerCase();
  if (EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
  return 'image/jpeg';
}

module.exports = { isAllowedImageMime, normalizeImageContentType, ALLOWED_IMAGE_MIMES };
