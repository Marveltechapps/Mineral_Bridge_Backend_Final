const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const path = require('path');

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_USER = process.env.S3_BUCKET_USER || 'mineral-bridge-user-files';
const BUCKET_ADMIN = process.env.S3_BUCKET_ADMIN || 'mineral-bridge-admin-files';

function getBucket(scope) {
  return scope === 'admin' ? BUCKET_ADMIN : BUCKET_USER;
}

/**
 * Sanitize a string for use in S3 key (alphanumeric, hyphen, underscore only).
 */
function sanitizeKeyPart(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 64) || '';
}

/** Allowed modules: first segment of key (home|buy|sell|more|admin). */
const MODULES = new Set(['home', 'buy', 'sell', 'more', 'admin']);

/** Normalize category to plan format (e.g. address_proofs -> address-proofs, license -> licence). */
function normalizeCategory(cat) {
  if (!cat || typeof cat !== 'string') return 'documents';
  const c = cat.toLowerCase().trim().replace(/_/g, '-');
  const map = {
    'address-proofs': 'address-proofs', 'address_proofs': 'address-proofs', 'addressproofs': 'address-proofs',
    'licence': 'licence', 'license': 'licence', 'licenses': 'licence',
    'ids': 'ids', 'id': 'ids', 'kyc': 'kyc', 'avatars': 'avatars', 'avatar': 'avatars',
    'banners': 'banners', 'images': 'images', 'photos': 'photos', 'documents': 'documents',
    'certifications': 'certifications', 'certificate': 'certifications', 'cert': 'certifications',
    'listings': 'listings', 'emergency-evidence': 'emergency-evidence', 'general': 'documents',
  };
  return map[c] || sanitizeKeyPart(cat) || 'documents';
}

/**
 * Upload a buffer to S3 with module/category path (plan: module/category/userId/unique_filename.ext).
 * @param {Buffer} buffer
 * @param {object} opts
 * @param {string} [opts.module]  - home|buy|sell|more|admin (default: admin if scope=admin, else 'more')
 * @param {string} opts.folder   - category e.g. 'banners', 'address-proofs', 'avatars'
 * @param {string} [opts.subfolder] - optional (e.g. 'splash' for banners, 'national-id' for kyc)
 * @param {string} opts.userId   - owner id
 * @param {string} opts.filename - original filename (extension preserved; name sanitized in key)
 * @param {string} opts.contentType - MIME type
 * @param {string} [opts.scope]  - 'user' or 'admin'
 * @param {string} [opts.title]   - optional S3 metadata
 * @param {string} [opts.subtopic] - optional S3 metadata
 * @returns {Promise<{ key: string, bucket: string }>}
 */
async function uploadToS3(buffer, { module: mod, folder, subfolder, userId, filename, contentType, scope = 'user', title, subtopic } = {}) {
  const ext = path.extname(filename) || mimeToExt(contentType);
  const unique = crypto.randomBytes(8).toString('hex');
  const category = normalizeCategory(folder);
  let modulePart = mod && MODULES.has(String(mod).toLowerCase()) ? String(mod).toLowerCase() : (scope === 'admin' ? 'admin' : 'more');
  const safeSub = sanitizeKeyPart(subfolder);
  const baseName = path.basename(filename, path.extname(filename)) || 'file';
  const safeName = sanitizeKeyPart(baseName).slice(0, 48) || 'file';
  const ownerId = userId || (scope === 'admin' ? 'admin' : 'anonymous');
  const pathParts = [modulePart, category, safeSub, ownerId, `${unique}_${safeName}${ext}`].filter(Boolean);
  const key = pathParts.join('/');
  const bucket = getBucket(scope);

  const metadata = {};
  if (title != null && String(title).trim()) metadata.title = String(title).trim().slice(0, 512);
  if (subtopic != null && String(subtopic).trim()) metadata.subtopic = String(subtopic).trim().slice(0, 256);

  // Allow clients to cache images (and other static assets) for 24h to improve load times
  const isImage = contentType && String(contentType).toLowerCase().startsWith('image/');
  const cacheControl = isImage ? 'public, max-age=86400' : undefined;

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    ...(cacheControl && { CacheControl: cacheControl }),
    ...(Object.keys(metadata).length > 0 && { Metadata: metadata }),
  }));

  return { key, bucket };
}

/**
 * Generate a presigned GET URL (default 1 hour expiry).
 */
async function presignedUrl(key, { scope = 'user', expiresIn = 3600 } = {}) {
  const bucket = getBucket(scope);
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn });
}

/**
 * Delete an object from S3.
 */
async function deleteFromS3(key, { scope = 'user' } = {}) {
  const bucket = getBucket(scope);
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * Build the permanent public-style URL (only useful if bucket policy allows public reads).
 * For private buckets, use presignedUrl() instead.
 */
function s3Url(key, scope = 'user') {
  const bucket = getBucket(scope);
  const region = process.env.AWS_REGION || 'ap-south-1';
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

function mimeToExt(mime) {
  const map = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };
  return map[mime] || '.bin';
}

module.exports = { s3, uploadToS3, presignedUrl, deleteFromS3, s3Url, getBucket, BUCKET_USER, BUCKET_ADMIN, sanitizeKeyPart, normalizeCategory, MODULES };
