const express = require('express');
const multer = require('multer');
const { authMiddleware } = require('../middleware/auth');
const { uploadToS3, presignedUrl, deleteFromS3 } = require('../config/s3');

const router = express.Router();

const ALLOWED_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'audio/mpeg',
  'audio/mp3',
  'audio/webm',
  'audio/wav',
  'audio/mp4',
  'audio/ogg',
  'audio/x-m4a',
];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB (allow larger for call recordings)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    const name = file.originalname || '';
    const okExcelExt = /\.(xlsx|xls)$/i.test(name);
    const octet = !file.mimetype || file.mimetype === 'application/octet-stream';
    if (okExcelExt && octet) {
      cb(null, true);
      return;
    }
    cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

/**
 * POST /api/upload
 * Multipart form: file (required), folder/category, scope ('user'|'admin'), module (home|buy|sell|more|admin),
 *   subfolder (optional), title, subtopic.
 * S3 key format: module/category/[subfolder/]userId/unique_sanitizedFilename.ext
 * Returns { key, url, title, subtopic, category, subfolder, module } where url is a presigned GET URL.
 */
router.post('/', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const folder = req.body.category || req.body.folder || 'general';
    const subfolder = req.body.subfolder || req.body.subtopic || '';
    const module = req.body.module || ''; // home|buy|sell|more|admin
    const title = req.body.title != null ? req.body.title : '';
    const subtopic = req.body.subtopic != null ? req.body.subtopic : '';
    const scope = req.body.scope === 'admin' ? 'admin' : 'user';

    const { key } = await uploadToS3(req.file.buffer, {
      module: module || undefined,
      folder,
      subfolder: subfolder || undefined,
      userId: scope === 'admin' ? 'admin' : req.user.id,
      filename: req.file.originalname,
      contentType: req.file.mimetype,
      scope,
      title: title || undefined,
      subtopic: subtopic || undefined,
    });

    const url = await presignedUrl(key, { scope });

    res.json({
      key,
      url,
      title: title || undefined,
      subtopic: subtopic || undefined,
      category: folder,
      subfolder: subfolder || undefined,
      module: module || undefined,
    });
  } catch (err) {
    console.error('POST /upload error:', err);
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

/**
 * POST /api/upload/multiple
 * Same as single; form: files (up to 5), folder/category, scope, module, subfolder, title_0, title_1...
 * Returns { files: [{ key, url, title, subtopic, category, subfolder, module }] }
 */
router.post('/multiple', authMiddleware, upload.array('files', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    const folder = req.body.category || req.body.folder || 'general';
    const subfolder = req.body.subfolder || req.body.subtopic || '';
    const module = req.body.module || '';
    const subtopic = req.body.subtopic != null ? req.body.subtopic : '';
    const scope = req.body.scope === 'admin' ? 'admin' : 'user';

    const results = await Promise.all(
      req.files.map(async (file, i) => {
        const title = req.body[`title_${i}`] != null ? req.body[`title_${i}`] : (req.body.title || '');
        const { key } = await uploadToS3(file.buffer, {
          module: module || undefined,
          folder,
          subfolder: subfolder || undefined,
          userId: scope === 'admin' ? 'admin' : req.user.id,
          filename: file.originalname,
          contentType: file.mimetype,
          scope,
          title: title || undefined,
          subtopic: subtopic || undefined,
        });
        const url = await presignedUrl(key, { scope });
        return {
          key,
          url,
          title: title || undefined,
          subtopic: subtopic || undefined,
          category: folder,
          subfolder: subfolder || undefined,
          module: module || undefined,
        };
      })
    );

    res.json({ files: results });
  } catch (err) {
    console.error('POST /upload/multiple error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

/**
 * POST /api/upload/presign
 * Body: { key, scope? }
 * Returns a fresh presigned URL for an already-uploaded file.
 */
router.post('/presign', authMiddleware, async (req, res) => {
  try {
    const { key, scope } = req.body || {};
    if (!key) return res.status(400).json({ error: 'key is required' });
    const url = await presignedUrl(key, { scope: scope === 'admin' ? 'admin' : 'user' });
    res.json({ key, url });
  } catch (err) {
    console.error('POST /upload/presign error:', err);
    res.status(500).json({ error: 'Failed to generate URL' });
  }
});

/**
 * DELETE /api/upload
 * Body: { key, scope? }
 */
router.delete('/', authMiddleware, async (req, res) => {
  try {
    const { key, scope } = req.body || {};
    if (!key) return res.status(400).json({ error: 'key is required' });
    await deleteFromS3(key, { scope: scope === 'admin' ? 'admin' : 'user' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /upload error:', err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

module.exports = router;
