const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const DEFAULTS = {
  language: 'English',
  currency: 'USD ($)',
  theme: 'System',
  defaultUnit: 'kg',
  defaultDelivery: 'Direct',
  autoSaveDrafts: true,
  priceDisplay: 'Per kg',
  priceAlerts: true,
  auctionUpdates: true,
  miningStatus: false,
  orderUpdates: true,
  paymentReceived: true,
  chatMessages: true,
  kycUpdates: true,
  biometricLock: false,
  autoLockTimeout: '5 min',
  shareAnalytics: false,
  profileVisibility: 'Verified Traders Only',
  aiInsights: true,
  aiPricePredictions: true,
  marketTrendAlerts: true,
};

const ALLOWED_KEYS = Object.keys(DEFAULTS);
const BOOL_KEYS = ALLOWED_KEYS.filter((k) => typeof DEFAULTS[k] === 'boolean');

async function getSettings(userId) {
  const db = getDB();
  const doc = await db.collection('app_settings').findOne({ userId });
  const settings = { ...DEFAULTS };
  if (doc) {
    for (const k of ALLOWED_KEYS) {
      if (doc[k] !== undefined) settings[k] = doc[k];
    }
  }
  return settings;
}

async function updateSettings(userId, body) {
  const updates = { updatedAt: new Date() };
  for (const k of ALLOWED_KEYS) {
    if (body[k] !== undefined) {
      updates[k] = BOOL_KEYS.includes(k) ? Boolean(body[k]) : body[k];
    }
  }
  const db = getDB();
  await db.collection('app_settings').updateOne(
    { userId },
    { $set: { ...updates, userId } },
    { upsert: true },
  );
  return getSettings(userId);
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    res.json(await getSettings(req.user.id));
  } catch (err) {
    console.error('GET /app-settings error:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

router.put('/', authMiddleware, async (req, res) => {
  try {
    res.json(await updateSettings(req.user.id, req.body || {}));
  } catch (err) {
    console.error('PUT /app-settings error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

router.patch('/', authMiddleware, async (req, res) => {
  try {
    res.json(await updateSettings(req.user.id, req.body || {}));
  } catch (err) {
    console.error('PATCH /app-settings error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/**
 * POST /api/app-settings/export
 * Gathers all user data and returns as JSON (frontend converts to PDF).
 */
router.post('/export', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const uid = req.user.id;
    const oid = new ObjectId(uid);

    const [user, settings, orders, addresses, paymentMethods, kycDocs, artisanal] = await Promise.all([
      db.collection('users').findOne({ _id: oid }),
      db.collection('app_settings').findOne({ userId: uid }),
      db.collection('orders').find({ userId: uid }).sort({ createdAt: -1 }).limit(200).toArray(),
      db.collection('addresses').find({ userId: uid }).toArray(),
      db.collection('payment_methods').find({ userId: uid }).toArray(),
      db.collection('kyc_documents').find({ userId: uid }).toArray(),
      db.collection('artisanal_profiles').findOne({ userId: uid }),
    ]);

    const sanitize = (doc) => {
      if (!doc) return null;
      const copy = { ...doc };
      delete copy._id;
      delete copy.userId;
      if (copy.frontImage) copy.frontImage = '[image data]';
      if (copy.backImage) copy.backImage = '[image data]';
      if (copy.licenseUrl) copy.licenseUrl = '[file data]';
      return copy;
    };

    res.json({
      exportedAt: new Date().toISOString(),
      profile: sanitize(user),
      settings: sanitize(settings),
      orders: orders.map((o) => ({ id: o._id.toString(), orderId: o.orderId, type: o.type, mineralName: o.mineralName, quantity: o.quantity, status: o.status, createdAt: o.createdAt })),
      addresses: addresses.map(sanitize),
      paymentMethods: paymentMethods.map((pm) => {
        const s = sanitize(pm);
        if (s && s.accountNumber) s.accountNumber = '****' + String(s.accountNumber).slice(-4);
        return s;
      }),
      kycDocuments: kycDocs.map((d) => ({ idType: d.idType, status: d.status, uploadedAt: d.uploadedAt })),
      artisanalProfile: sanitize(artisanal),
    });
  } catch (err) {
    console.error('POST /app-settings/export error:', err);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

/**
 * POST /api/app-settings/clear-cache
 * Clears user-specific cached/temp data from the server.
 */
router.post('/clear-cache', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const uid = req.user.id;
    await Promise.all([
      db.collection('user_cache').deleteMany({ userId: uid }),
      db.collection('draft_orders').deleteMany({ userId: uid }),
    ]);
    res.json({ success: true, message: 'Cache cleared successfully' });
  } catch (err) {
    console.error('POST /app-settings/clear-cache error:', err);
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

/**
 * POST /api/app-settings/delete-account
 * Submits an account deletion request (soft delete — marks for review).
 */
router.post('/delete-account', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const uid = req.user.id;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 2000) : '';
    const existing = await db.collection('account_deletions').findOne({ userId: uid, status: 'pending' });
    if (existing) {
      return res.json({ success: true, message: 'Deletion request already submitted. Under review.' });
    }
    const reqAt = new Date();
    await db.collection('account_deletions').insertOne({
      userId: uid,
      userName: req.user.name || '',
      userEmail: req.user.email || '',
      userPhone: req.user.phone || '',
      status: 'pending',
      type: 'user_requested',
      reason: reason || undefined,
      requestedAt: reqAt,
      createdAt: reqAt,
    });
    try {
      await db.collection('profiles').updateOne(
        { userId: uid },
        { $set: { accountStatus: 'deletion_requested', updatedAt: reqAt } },
      );
    } catch (profileErr) {
      console.warn('delete-account: profile status update failed:', profileErr.message);
    }
    res.json({ success: true, message: 'Account deletion request submitted. You will be notified within 48 hours.' });
  } catch (err) {
    console.error('POST /app-settings/delete-account error:', err);
    res.status(500).json({ error: 'Failed to submit deletion request' });
  }
});

module.exports = router;
