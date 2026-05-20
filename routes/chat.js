const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/chat/:orderId
 * Returns all messages for a given order, sorted oldest-first.
 */
router.get('/:orderId', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const messages = await db
      .collection('chat_messages')
      .find({ orderId: req.params.orderId })
      .sort({ createdAt: 1 })
      .limit(500)
      .toArray();
    res.json(
      messages.map((m) => ({
        id: m._id.toString(),
        orderId: m.orderId,
        senderId: m.senderId,
        senderName: m.senderName,
        senderRole: m.senderRole,
        text: m.text,
        createdAt: m.createdAt,
      }))
    );
  } catch (err) {
    console.error('GET /chat/:orderId error:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

/**
 * POST /api/chat/:orderId
 * Body: { text }
 * Creates a new message from the authenticated user.
 */
router.post('/:orderId', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Message text is required' });
    }
    const db = getDB();
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.id) });
    const now = new Date();
    const message = {
      orderId: req.params.orderId,
      senderId: req.user.id,
      senderName: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email : 'User',
      senderRole: 'user',
      text: text.trim(),
      createdAt: now,
    };
    const result = await db.collection('chat_messages').insertOne(message);
    res.status(201).json({
      id: result.insertedId.toString(),
      ...message,
    });
  } catch (err) {
    console.error('POST /chat/:orderId error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

module.exports = router;
