const express = require('express');
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/activity
 * Returns activity feed for Dashboard: blockchain verification logs, price triggers, order updates.
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const list = await db
      .collection('activity_feed')
      .find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(30)
      .toArray();
    res.json(
      list.map((a) => ({
        id: a._id?.toString(),
        type: a.type || 'verification',
        title: a.title,
        message: a.message,
        createdAt: a.createdAt,
        metadata: a.metadata || {},
      }))
    );
  } catch (err) {
    console.error('GET /activity error:', err);
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

/**
 * POST /api/activity
 * Internal: append an activity item (e.g. from order/verification flow).
 * Body: { type?, title, message?, metadata? }
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { type, title, message, metadata } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });
    const db = getDB();
    const doc = {
      userId: req.user.id,
      type: type || 'verification',
      title: String(title),
      message: message || '',
      metadata: metadata || {},
      createdAt: new Date(),
    };
    const result = await db.collection('activity_feed').insertOne(doc);
    const inserted = await db.collection('activity_feed').findOne({ _id: result.insertedId });
    res.status(201).json({
      id: inserted._id.toString(),
      type: inserted.type,
      title: inserted.title,
      createdAt: inserted.createdAt,
    });
  } catch (err) {
    console.error('POST /activity error:', err);
    res.status(500).json({ error: 'Failed to create activity' });
  }
});

module.exports = router;
