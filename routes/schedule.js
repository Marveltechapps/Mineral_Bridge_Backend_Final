const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/schedule
 * Returns all scheduled calls for the authenticated user.
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const list = await db
      .collection('scheduled_calls')
      .find({ userId: req.user.id })
      .sort({ scheduledAt: -1 })
      .limit(50)
      .toArray();
    res.json(
      list.map((s) => ({
        id: s._id.toString(),
        orderId: s.orderId,
        userId: s.userId,
        date: s.date,
        time: s.time,
        scheduledAt: s.scheduledAt,
        note: s.note,
        status: s.status,
        createdAt: s.createdAt,
      }))
    );
  } catch (err) {
    console.error('GET /schedule error:', err);
    res.status(500).json({ error: 'Failed to fetch schedules' });
  }
});

/**
 * POST /api/schedule
 * Body: { orderId, date, time, note? }
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { orderId, date, time, note } = req.body || {};
    if (!orderId || !date || !time) {
      return res.status(400).json({ error: 'orderId, date, and time are required' });
    }
    const db = getDB();
    const scheduledAt = new Date(`${date}T${time}`);
    const now = new Date();
    const doc = {
      orderId,
      userId: req.user.id,
      date,
      time,
      scheduledAt,
      note: note || '',
      status: 'scheduled',
      createdAt: now,
    };
    const result = await db.collection('scheduled_calls').insertOne(doc);
    res.status(201).json({
      id: result.insertedId.toString(),
      ...doc,
    });
  } catch (err) {
    console.error('POST /schedule error:', err);
    res.status(500).json({ error: 'Failed to schedule call' });
  }
});

module.exports = router;
