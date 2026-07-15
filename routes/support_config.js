const express = require('express');
const router = express.Router();
const { getDB } = require('../config/db');

/** Support email order: 1) Dashboard Settings (platform_settings), 2) .env SUPPORT_EMAIL, 3) fallback */
const FALLBACK_SUPPORT_EMAIL = 'support@mineralbridge.com';
const FALLBACK_APP_VERSION = '1.0.0';

router.get('/', async (_req, res) => {
  try {
    let supportEmail = process.env.SUPPORT_EMAIL || FALLBACK_SUPPORT_EMAIL;
    let appVersion = process.env.APP_VERSION || FALLBACK_APP_VERSION;
    try {
      const db = getDB();
      const doc = await db.collection('platform_settings').findOne({});
      if (doc && doc.supportEmail && String(doc.supportEmail).trim()) {
        supportEmail = String(doc.supportEmail).trim();
      }
      if (doc && doc.appVersion && String(doc.appVersion).trim()) {
        appVersion = String(doc.appVersion).trim();
      }
    } catch (_) {
      // use .env or fallback if DB read fails
    }
    res.json({ supportEmail, appVersion });
  } catch (err) {
    res.status(500).json({
      supportEmail: process.env.SUPPORT_EMAIL || FALLBACK_SUPPORT_EMAIL,
      appVersion: process.env.APP_VERSION || FALLBACK_APP_VERSION,
    });
  }
});

module.exports = router;
