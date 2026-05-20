const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/security-alerts
 * Returns all active (non-dismissed) security alerts for the authenticated user.
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const list = await db
      .collection('security_alerts')
      .find({ userId: req.user.id, dismissed: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    res.json(
      list.map((a) => ({
        id: a._id.toString(),
        type: a.type,
        title: a.title,
        message: a.message,
        severity: a.severity || 'info',
        createdAt: a.createdAt,
      })),
    );
  } catch (err) {
    console.error('GET /security-alerts error:', err);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

/**
 * PATCH /api/security-alerts/:id/dismiss
 * Dismisses (acknowledges) a single alert.
 */
router.patch('/:id/dismiss', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid alert id' });

    const db = getDB();
    await db.collection('security_alerts').updateOne(
      { _id: new ObjectId(id), userId: req.user.id },
      { $set: { dismissed: true, dismissedAt: new Date() } },
    );
    res.json({ success: true });
  } catch (err) {
    console.error('PATCH /security-alerts/:id/dismiss error:', err);
    res.status(500).json({ error: 'Failed to dismiss alert' });
  }
});

/**
 * POST /api/security-alerts/dismiss-all
 * Dismisses all alerts for the authenticated user.
 */
router.post('/dismiss-all', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    await db.collection('security_alerts').updateMany(
      { userId: req.user.id, dismissed: { $ne: true } },
      { $set: { dismissed: true, dismissedAt: new Date() } },
    );
    res.json({ success: true });
  } catch (err) {
    console.error('POST /security-alerts/dismiss-all error:', err);
    res.status(500).json({ error: 'Failed to dismiss alerts' });
  }
});

module.exports = router;

/**
 * Helper: create a security alert for a user.
 * Called from auth routes when suspicious activity is detected.
 */
module.exports.createAlert = async function createAlert(userId, { type, title, message, severity }) {
  try {
    const db = getDB();
    await db.collection('security_alerts').insertOne({
      userId: String(userId),
      type: type || 'general',
      title: title || 'Security Alert',
      message: message || '',
      severity: severity || 'warning',
      dismissed: false,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error('createAlert error:', err);
  }
};
