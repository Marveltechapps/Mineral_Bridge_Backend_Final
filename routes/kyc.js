const express = require('express');
const { ObjectId } = require('mongodb');
const multer = require('multer');
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { uploadToS3, presignedUrl, deleteFromS3 } = require('../config/s3');
const { detectFaceInImage } = require('../lib/faceCheck');
const { isAllowedImageMime, normalizeImageContentType } = require('../lib/imageMime');

const router = express.Router();

const VALID_ID_TYPES = ['national-id', 'passport', 'corporate', 'driving-license'];

function isAllowedKycFile(file) {
  if (!file) return false;
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime === 'application/pdf') return true;
  if (isAllowedImageMime(file.mimetype, file.originalname)) return true;
  // Extra document formats commonly produced by phones / scanners
  if (['image/gif', 'image/bmp', 'image/x-ms-bmp', 'image/tiff'].includes(mime)) return true;
  if ((!mime || mime === 'application/octet-stream') && /\.(gif|bmp|tiff?|pdf)$/i.test(file.originalname || '')) {
    return true;
  }
  return false;
}

const kycUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedKycFile(file)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype || 'unknown'}. Use an image or PDF.`));
  },
});

const kycFields = kycUpload.fields([
  { name: 'front', maxCount: 1 },
  { name: 'back', maxCount: 1 },
  { name: 'selfie', maxCount: 1 },
  { name: 'liveFace', maxCount: 1 },
]);

/**
 * Helper: upload a single KYC file to S3 and return the S3 key.
 * Returns null if no file provided.
 */
async function uploadKycFile(file, userId, idType, side) {
  if (!file) return null;
  const contentType =
    file.mimetype === 'application/pdf'
      ? 'application/pdf'
      : normalizeImageContentType(file.mimetype, file.originalname);
  const { key } = await uploadToS3(file.buffer, {
    module: 'more',
    folder: 'kyc',
    subfolder: idType,
    userId,
    filename: `${side}${require('path').extname(file.originalname) || (contentType === 'application/pdf' ? '.pdf' : '.jpg')}`,
    contentType,
    scope: 'user',
  });
  return key;
}

/**
 * POST /api/kyc/documents
 * Accepts multipart form: idType (required), front (file), back (file), selfie (file)
 * Also still accepts JSON body with S3 keys: { idType, frontKey?, backKey?, selfieKey? }
 * Images are stored at original resolution; no fixed dimensions or server-side resize/crop.
 */
router.post('/documents', authMiddleware, kycFields, async (req, res) => {
  try {
    const idType = req.body?.idType;
    const normalized = idType ? String(idType).toLowerCase().replace(/\s+/g, '-') : '';
    if (!VALID_ID_TYPES.includes(normalized)) {
      return res.status(400).json({ error: 'idType must be national-id, passport, corporate, or driving-license' });
    }

    const frontFile = req.files?.front?.[0] || null;
    const backFile = req.files?.back?.[0] || null;
    const selfieFile = req.files?.selfie?.[0] || null;
    const liveFaceFile = req.files?.liveFace?.[0] || null;

    // Prefer live face for biometric check; fall back to selfie.
    const faceFile = liveFaceFile || selfieFile;
    if (faceFile && faceFile.buffer) {
      const hasFace = await detectFaceInImage(faceFile.buffer);
      if (!hasFace) {
        return res.status(400).json({
          error: 'Only your live face is accepted. Please look at the camera with your face clearly visible. Photos, documents, or other objects cannot be used to unlock access.',
          code: 'NO_FACE_DETECTED',
        });
      }
    }

    const frontKey = frontFile
      ? await uploadKycFile(frontFile, req.user.id, normalized, 'front')
      : (req.body.frontKey || null);
    const backKey = backFile
      ? await uploadKycFile(backFile, req.user.id, normalized, 'back')
      : (req.body.backKey || null);
    const selfieKey = selfieFile
      ? await uploadKycFile(selfieFile, req.user.id, normalized, 'selfie')
      : (req.body.selfieKey || null);
    const liveFaceKey = liveFaceFile
      ? await uploadKycFile(liveFaceFile, req.user.id, normalized, 'liveFace')
      : (req.body.liveFaceKey || null);

    const db = getDB();
    const now = new Date();
    const updateFields = { status: 'draft', updatedAt: now };
    if (frontKey) updateFields.frontKey = frontKey;
    if (backKey) updateFields.backKey = backKey;
    if (selfieKey) updateFields.selfieKey = selfieKey;
    if (liveFaceKey) updateFields.liveFaceKey = liveFaceKey;

    const filter = { userId: req.user.id, idType: normalized };
    await db.collection('kyc_documents').updateOne(
      filter,
      {
        $set: updateFields,
        $setOnInsert: { userId: req.user.id, idType: normalized, createdAt: now },
      },
      { upsert: true }
    );
    const updated = await db.collection('kyc_documents').findOne(filter);
    if (!updated) {
      return res.status(500).json({ error: 'Document not found after save' });
    }

    const frontUrl = updated.frontKey ? await presignedUrl(updated.frontKey) : (updated.frontUrl || null);
    const backUrl = updated.backKey ? await presignedUrl(updated.backKey) : (updated.backUrl || null);
    const selfieUrl = updated.selfieKey ? await presignedUrl(updated.selfieKey) : (updated.selfieUrl || null);
    const liveFaceUrl = updated.liveFaceKey ? await presignedUrl(updated.liveFaceKey) : (updated.liveFaceUrl || null);

    res.json({
      idType: updated.idType,
      frontKey: updated.frontKey || null,
      backKey: updated.backKey || null,
      selfieKey: updated.selfieKey || null,
      liveFaceKey: updated.liveFaceKey || null,
      frontUrl,
      backUrl,
      selfieUrl,
      liveFaceUrl,
      status: updated.status,
    });
  } catch (err) {
    console.error('POST /kyc/documents error:', err);
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    }
    const code = err.code || err.codeName;
    const msg = err.message || '';
    if (code === 11000 || msg.includes('duplicate key')) {
      return res.status(409).json({
        error: 'Document for this ID type already exists. Run: node scripts/ensure-indexes.js (then try again).',
      });
    }
    res.status(500).json({ error: err.message || 'Failed to save documents' });
  }
});

/**
 * POST /api/kyc/submit
 * Body: { idType? } – if provided, marks that doc type as under_review; else marks all draft docs.
 * Sets digitalIdentityHash for Success Certification.
 */
router.post('/submit', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { idType } = req.body || {};
    const filter = { userId: req.user.id };
    if (idType && VALID_ID_TYPES.includes(String(idType).toLowerCase().replace(/\s+/g, '-'))) {
      filter.idType = String(idType).toLowerCase().replace(/\s+/g, '-');
    }
    const docs = await db.collection('kyc_documents').find(filter).toArray();
    if (!docs.length) return res.status(400).json({ error: 'No KYC documents to submit' });

    // Require a complete set of documents before we move anything to "under_review".
    // This ensures the app never shows "Verified" until an admin approves it after review.
    const isDocComplete = (d) => {
      const isPassport = d.idType === 'passport';
      const frontOk = !!(d.frontKey || d.frontUrl);
      const backOk = isPassport || !!(d.backKey || d.backUrl);
      const selfieOk = !!(d.selfieKey || d.selfieUrl);
      const liveFaceOk = !!(d.liveFaceKey || d.liveFaceUrl);
      // Accept legacy docs that predate liveFaceKey (selfie only).
      const biometricsOk = liveFaceOk || (selfieOk && d.liveFaceKey === undefined && d.liveFaceUrl === undefined);
      return frontOk && backOk && selfieOk && biometricsOk;
    };
    const incompleteDocs = docs.filter((d) => !isDocComplete(d));
    if (incompleteDocs.length) {
      return res.status(400).json({
        error: 'Please upload the full KYC set before submitting (front, back, selfie, and live face photo).',
      });
    }

    const digitalIdentityHash = '0x' + Buffer.from(req.user.id + Date.now()).toString('hex').slice(0, 40);
    await db.collection('kyc_documents').updateMany(
      filter,
      { $set: { status: 'under_review', submittedAt: new Date(), digitalIdentityHash } }
    );
    await db.collection('profiles').updateOne(
      { userId: req.user.id },
      { $set: { kycStatus: 'under_review', updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ status: 'under_review', digitalIdentityHash });
  } catch (err) {
    console.error('POST /kyc/submit error:', err);
    res.status(500).json({ error: 'Failed to submit KYC' });
  }
});

/**
 * GET /api/kyc/documents/:idType/image?side=front|back|selfie
 * Returns a presigned S3 URL (redirect) or serves legacy base64 data.
 * Token may be passed in query (token=) for Image component compatibility.
 */
router.get('/documents/:idType/image', authMiddleware, async (req, res) => {
  try {
    const { idType } = req.params;
    const side = ['back', 'selfie'].includes(req.query?.side) ? req.query.side : 'front';
    const normalized = idType ? String(idType).toLowerCase().replace(/\s+/g, '-') : '';
    if (!VALID_ID_TYPES.includes(normalized)) {
      return res.status(400).json({ error: 'Invalid idType' });
    }
    const db = getDB();
    let doc = await db.collection('kyc_documents').findOne({ userId: req.user.id, idType: normalized });
    if (!doc && normalized === 'driving-license') {
      doc = await db.collection('kyc_documents').findOne({ userId: req.user.id, idType: 'corporate' });
    }
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const keyField = side === 'back' ? 'backKey' : side === 'selfie' ? 'selfieKey' : 'frontKey';
    const urlField = side === 'back' ? 'backUrl' : side === 'selfie' ? 'selfieUrl' : 'frontUrl';

    if (doc[keyField]) {
      const signed = await presignedUrl(doc[keyField]);
      return res.redirect(signed);
    }

    const url = doc[urlField];
    if (!url || typeof url !== 'string') return res.status(404).json({ error: 'Image not found' });
    if (url.startsWith('data:')) {
      const match = url.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return res.status(500).json({ error: 'Invalid stored image format' });
      const contentType = match[1].trim();
      const buffer = Buffer.from(match[2], 'base64');
      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'private, max-age=300');
      res.send(buffer);
      return;
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return res.redirect(url);
    }
    res.status(400).json({ error: 'Unsupported image format' });
  } catch (err) {
    console.error('GET /kyc/documents/:idType/image error:', err);
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

/**
 * GET /api/kyc/status
 * Returns current KYC status and all document types with presigned S3 URLs.
 */
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const profile = await db.collection('profiles').findOne({ userId: req.user.id });
    const docs = await db.collection('kyc_documents').find({ userId: req.user.id }).toArray();

    const documents = await Promise.all(docs.map(async (d) => {
      const frontUrl = d.frontKey ? await presignedUrl(d.frontKey) : (d.frontUrl || null);
      const backUrl = d.backKey ? await presignedUrl(d.backKey) : (d.backUrl || null);
      const selfieUrl = d.selfieKey ? await presignedUrl(d.selfieKey) : (d.selfieUrl || null);
      const liveFaceUrl = d.liveFaceKey ? await presignedUrl(d.liveFaceKey) : (d.liveFaceUrl || null);
      return {
        idType: d.idType,
        frontKey: d.frontKey || null,
        backKey: d.backKey || null,
        selfieKey: d.selfieKey || null,
        liveFaceKey: d.liveFaceKey || null,
        frontUrl,
        backUrl,
        selfieUrl,
        liveFaceUrl,
        status: d.status,
        digitalIdentityHash: d.digitalIdentityHash,
      };
    }));

    res.json({ kycStatus: profile?.kycStatus || 'pending', documents });
  } catch (err) {
    console.error('GET /kyc/status error:', err);
    res.status(500).json({ error: 'Failed to fetch KYC status' });
  }
});

module.exports = router;
