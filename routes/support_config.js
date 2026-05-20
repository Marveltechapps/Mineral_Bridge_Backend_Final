const express = require('express');
const router = express.Router();
const { getDB } = require('../config/db');

/** Support email order: 1) Dashboard Settings (platform_settings), 2) .env SUPPORT_EMAIL, 3) fallback */
const FALLBACK_SUPPORT_EMAIL = 'support@mineralbridge.com';

router.get('/', async (_req, res) => {
  try {
    let supportEmail = process.env.SUPPORT_EMAIL || FALLBACK_SUPPORT_EMAIL;
    try {
      const db = getDB();
      const doc = await db.collection('platform_settings').findOne({});
      if (doc && doc.supportEmail && String(doc.supportEmail).trim()) {
        supportEmail = String(doc.supportEmail).trim();
      }
    } catch (_) {
      // use .env or fallback if DB read fails
    }
    res.json({ supportEmail });
  } catch (err) {
    res.status(500).json({
      supportEmail: process.env.SUPPORT_EMAIL || FALLBACK_SUPPORT_EMAIL,
    });
  }
});

module.exports = router;
