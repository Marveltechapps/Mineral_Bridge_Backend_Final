const express = require('express');
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/push-token
 * Body: { expoPushToken }
 * Register device push token for the logged-in user. App calls this after login.
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { expoPushToken } = req.body || {};
    if (!expoPushToken || typeof expoPushToken !== 'string') {
      return res.status(400).json({ error: 'expoPushToken is required' });
    }
    const userId = req.user.id;
    const db = getDB();
    await db.collection('push_tokens').updateOne(
      { userId, expoPushToken },
      { $set: { userId, expoPushToken, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('POST /push-token error:', err);
    res.status(500).json({ error: 'Failed to register push token' });
  }
});

module.exports = router;
