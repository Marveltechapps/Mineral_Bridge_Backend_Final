const express = require('express');
const multer = require('multer');
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { uploadToS3, presignedUrl } = require('../config/s3');
const { isAllowedImageMime, normalizeImageContentType } = require('../lib/imageMime');

const router = express.Router();

/**
 * GET /api/users/me
 * Returns current user (requires auth).
 */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const profile = await db.collection('profiles').findOne({ userId: req.user.id });
    const avatarUrl = profile?.avatarKey
      ? await presignedUrl(profile.avatarKey)
      : (profile?.avatarUrl || null);
    const userDoc = await db.collection('users').findOne({ _id: req.user._id });
    const phoneKey = userDoc?.phone || req.user.phone;
    const isEmailLogin =
      typeof phoneKey === 'string' && phoneKey.toLowerCase().startsWith('email|');
    const loginEmailFromKey = isEmailLogin ? phoneKey.slice('email|'.length).trim() : null;
    let displayPhone = null;
    if (!isEmailLogin && userDoc?.mobileNumber) {
      const dial = userDoc.countryCode || '';
      displayPhone = `${dial} ${userDoc.mobileNumber}`.trim();
    } else if (!isEmailLogin && typeof phoneKey === 'string' && phoneKey.includes('|')) {
      displayPhone = phoneKey.replace('|', ' ').trim();
    }

    res.json({
      ...req.user,
      isEmailLogin,
      displayPhone,
      email: req.user.email || userDoc?.email || loginEmailFromKey || null,
      kycStatus: profile?.kycStatus || 'pending',
      kycRejectionReason: profile?.kycRejectionReason || null,
      accountStatus: profile?.accountStatus || 'active',
      avatarKey: profile?.avatarKey || null,
      avatarUrl,
    });
  } catch (err) {
    console.error('GET /users/me error:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

/**
 * PATCH /api/users/me
 * Body: { name?, email? }
 */
router.patch('/me', authMiddleware, async (req, res) => {
  try {
    const { name, email } = req.body || {};
    const db = getDB();
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (Object.keys(updates).length === 0) {
      return res.json(req.user);
    }
    await db.collection('users').updateOne(
      { _id: req.user._id },
      { $set: updates }
    );
    res.json({ ...req.user, ...updates });
  } catch (err) {
    console.error('PATCH /users/me error:', err);
    res.status(500).json({ error: 'Update failed' });
  }
});

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedImageMime(file.mimetype, file.originalname)) cb(null, true);
    else cb(new Error(`Avatar must be an image (JPEG, PNG, WebP, or HEIC). Received: ${file.mimetype || 'unknown'}`));
  },
});

/**
 * PATCH /api/users/me/profile
 * Accepts multipart form with optional 'avatar' file, or JSON body with { avatarKey? }.
 */
router.patch('/me/profile', authMiddleware, (req, res, next) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: err.message || 'Invalid avatar upload' });
    }
    next();
  });
}, async (req, res) => {
  try {
    const db = getDB();
    const updates = { updatedAt: new Date() };

    if (req.file) {
      const contentType = normalizeImageContentType(req.file.mimetype, req.file.originalname);
      const { key } = await uploadToS3(req.file.buffer, {
        module: 'more',
        folder: 'avatars',
        userId: req.user.id,
        filename: req.file.originalname,
        contentType,
        scope: 'user',
      });
      updates.avatarKey = key;
    } else if (req.body?.avatarKey) {
      updates.avatarKey = req.body.avatarKey;
    }

    if (Object.keys(updates).length === 1) {
      return res.status(400).json({ error: 'No profile fields to update' });
    }

    await db.collection('profiles').updateOne(
      { userId: req.user.id },
      { $set: updates },
      { upsert: true }
    );
    const profile = await db.collection('profiles').findOne({ userId: req.user.id });
    const avatarUrl = profile?.avatarKey
      ? await presignedUrl(profile.avatarKey)
      : (profile?.avatarUrl || null);

    res.json({
      kycStatus: profile?.kycStatus || 'pending',
      avatarKey: profile?.avatarKey || null,
      avatarUrl,
    });
  } catch (err) {
    console.error('PATCH /users/me/profile error:', err);
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Profile update failed' });
  }
});

/**
 * GET /api/users/me/form-drafts
 * Returns last-used form data per flow for existing users (same mobile). New users get {}.
 * Used to auto-fill forms when user returns (Buy quantity, Sell details, etc.).
 */
router.get('/me/form-drafts', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const profile = await db.collection('profiles').findOne({ userId: req.user.id });
    const drafts = profile?.formDrafts && typeof profile.formDrafts === 'object' ? profile.formDrafts : {};
    res.json(drafts);
  } catch (err) {
    console.error('GET /users/me/form-drafts error:', err);
    res.status(500).json({ error: 'Failed to fetch form drafts' });
  }
});

/**
 * PATCH /api/users/me/form-drafts
 * Body: { flow: string, data: object } — e.g. { flow: 'buyQuantity', data: { quantity, unit, mineralType, buyerCategory } }
 * Saves last-used form data for this user (existing user by same mobile). Used for auto-fill on next visit.
 */
router.patch('/me/form-drafts', authMiddleware, async (req, res) => {
  try {
    const { flow, data } = req.body || {};
    if (!flow || typeof flow !== 'string' || !data || typeof data !== 'object') {
      return res.status(400).json({ error: 'flow and data required' });
    }
    const db = getDB();
    const key = `formDrafts.${flow}`;
    await db.collection('profiles').updateOne(
      { userId: req.user.id },
      { $set: { [key]: data, updatedAt: new Date() } },
      { upsert: true }
    );
    const profile = await db.collection('profiles').findOne({ userId: req.user.id });
    const drafts = profile?.formDrafts && typeof profile.formDrafts === 'object' ? profile.formDrafts : {};
    res.json(drafts);
  } catch (err) {
    console.error('PATCH /users/me/form-drafts error:', err);
    res.status(500).json({ error: 'Failed to save form draft' });
  }
});

/**
 * POST /api/users/me/location
 * Body: { latitude, longitude }
 * Saves the authenticated user's current location (same document as their phone/countryCode).
 * Requires auth. Location is stored with the user in DB for compliance/logistics.
 */
router.post('/me/location', authMiddleware, async (req, res) => {
  try {
    const { latitude, longitude } = req.body || {};
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Valid latitude and longitude required' });
    }
    const db = getDB();
    const now = new Date();
    await db.collection('users').updateOne(
      { _id: req.user._id },
      { $set: { lastLocation: { latitude: lat, longitude: lng, updatedAt: now } } }
    );
    res.json({ success: true, latitude: lat, longitude: lng, updatedAt: now });
  } catch (err) {
    console.error('POST /users/me/location error:', err);
    res.status(500).json({ error: 'Failed to save location' });
  }
});

/**
 * GET /api/users/me/security
 * Returns security settings: twoFactorEnabled, and data visibility info (public ledger vs private data).
 */
router.get('/me/security', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const profile = await db.collection('profiles').findOne({ userId: req.user.id });
    res.json({
      twoFactorEnabled: profile?.twoFactorEnabled ?? false,
      publicLedger: 'Hashes and provenance data are visible on the public ledger.',
      privateData: 'KYC, chat, and bank details are kept private and encrypted.',
    });
  } catch (err) {
    console.error('GET /users/me/security error:', err);
    res.status(500).json({ error: 'Failed to fetch security settings' });
  }
});

/**
 * PATCH /api/users/me/security
 * Body: { twoFactorEnabled?: boolean }
 */
router.patch('/me/security', authMiddleware, async (req, res) => {
  try {
    const { twoFactorEnabled } = req.body || {};
    if (typeof twoFactorEnabled !== 'boolean') {
      return res.status(400).json({ error: 'twoFactorEnabled must be a boolean' });
    }
    const db = getDB();
    await db.collection('profiles').updateOne(
      { userId: req.user.id },
      { $set: { twoFactorEnabled, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ twoFactorEnabled });
  } catch (err) {
    console.error('PATCH /users/me/security error:', err);
    res.status(500).json({ error: 'Failed to update security settings' });
  }
});

/**
 * GET /api/users/me/sessions
 * Returns active sessions (device name, last active) for Security & Privacy screen.
 */
router.get('/me/sessions', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const list = await db
      .collection('user_sessions')
      .find({ userId: req.user.id })
      .sort({ lastActiveAt: -1 })
      .limit(20)
      .toArray();
    res.json(
      list.map((s) => ({
        id: s._id.toString(),
        deviceName: s.deviceName || 'Unknown Device',
        lastActiveAt: s.lastActiveAt,
        createdAt: s.createdAt,
      }))
    );
  } catch (err) {
    console.error('GET /users/me/sessions error:', err);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

/**
 * POST /api/users/me/sessions
 * Body: { deviceName? }
 * Register current session (e.g. on app launch). Upserts by userId + deviceName or creates new.
 */
router.post('/me/sessions', authMiddleware, async (req, res) => {
  try {
    const { deviceName } = req.body || {};
    const db = getDB();
    const now = new Date();
    const doc = {
      userId: req.user.id,
      deviceName: deviceName || 'Mobile App',
      lastActiveAt: now,
      updatedAt: now,
    };
    const existing = await db.collection('user_sessions').findOne({ userId: req.user.id, deviceName: doc.deviceName });
    if (existing) {
      await db.collection('user_sessions').updateOne(
        { _id: existing._id },
        { $set: { lastActiveAt: now, updatedAt: now } }
      );
    } else {
      doc.createdAt = now;
      await db.collection('user_sessions').insertOne(doc);
    }
    const list = await db.collection('user_sessions').find({ userId: req.user.id }).sort({ lastActiveAt: -1 }).toArray();
    res.json(list.map((s) => ({ id: s._id.toString(), deviceName: s.deviceName, lastActiveAt: s.lastActiveAt })));
  } catch (err) {
    console.error('POST /users/me/sessions error:', err);
    res.status(500).json({ error: 'Failed to register session' });
  }
});

/**
 * DELETE /api/users/me/sessions/:id
 * Revoke a session (log out that device).
 */
router.delete('/me/sessions/:id', authMiddleware, async (req, res) => {
  try {
    const { ObjectId } = require('mongodb');
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid session id' });
    const db = getDB();
    const result = await db.collection('user_sessions').deleteOne({ _id: new ObjectId(id), userId: req.user.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Session not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /users/me/sessions/:id error:', err);
    res.status(500).json({ error: 'Failed to revoke session' });
  }
});

module.exports = router;
