const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/callbacks
 * Body: { orderId, orderLabel? }
 * Creates a callback request from the authenticated user for a specific order.
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { orderId, orderLabel } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });

    const db = getDB();

    if (orderId === 'help-support') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const existing = await db.collection('callbacks').findOne({
        userId: req.user.id,
        orderId: 'help-support',
        createdAt: { $gte: todayStart },
      });
      if (existing) {
        return res.status(429).json({ error: 'You have already requested a callback today. Try again tomorrow.' });
      }
    }

    const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.id) });

    const doc = {
      orderId: String(orderId),
      orderLabel: orderLabel || '',
      userId: req.user.id,
      userName: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '',
      userEmail: user?.email || '',
      userPhone: user?.phone || '',
      status: 'pending',
      createdAt: new Date(),
    };

    const callHistoryResult = await db.collection('call_history').insertOne({
      orderId: String(orderId),
      userId: doc.userId,
      userName: doc.userName || '',
      phoneNumber: doc.userPhone || '',
      type: 'call',
      note: `Callback requested by user - ${orderLabel || ''}`,
      conversationScenario: '',
      status: 'pending',
      at: new Date().toISOString(),
      admin: 'System',
      contextLabel: orderLabel ? `Callback — ${orderLabel}` : `Callback — ${orderId}`,
    });
    doc.callHistoryId = callHistoryResult.insertedId.toString();
    await db.collection('callbacks').insertOne(doc);

    // Mirror into scheduled_calls so dashboard Scheduled Calls module shows it
    const scheduledCallDoc = {
      userId: req.user.id,
      userName: doc.userName || '',
      userEmail: doc.userEmail || '',
      userPhone: doc.userPhone || '',
      reason: orderLabel || doc.orderLabel || 'Callback request',
      orderId: String(orderId),
      date: new Date(),
      scheduledAt: new Date(),
      createdAt: new Date(),
      status: 'pending',
      source: 'app_callback',
    };
    await db.collection('scheduled_calls').insertOne(scheduledCallDoc);

    res.status(201).json({ success: true, message: 'Callback request submitted' });
  } catch (err) {
    console.error('POST /callbacks error:', err);
    res.status(500).json({ error: 'Failed to submit callback request' });
  }
});

/**
 * GET /api/callbacks
 * Dashboard: returns all callback requests (with ?all=1 and x-dashboard-key)
 * User: returns only their own callback requests
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const filter = {};
    if (!(req.isDashboard && (req.query.all === '1' || req.query.all === 'true'))) {
      filter.userId = req.user.id;
    }
    if (req.query.status) filter.status = req.query.status;

    const list = await db.collection('callbacks').find(filter).sort({ createdAt: -1 }).limit(100).toArray();
    res.json(list.map((c) => ({
      id: c._id.toString(),
      orderId: c.orderId,
      orderLabel: c.orderLabel,
      userId: c.userId,
      userName: c.userName,
      userEmail: c.userEmail,
      userPhone: c.userPhone,
      status: c.status,
      createdAt: c.createdAt,
    })));
  } catch (err) {
    console.error('GET /callbacks error:', err);
    res.status(500).json({ error: 'Failed to fetch callback requests' });
  }
});

/**
 * PATCH /api/callbacks/:id
 * Dashboard can update status: 'pending' | 'acknowledged' | 'completed'
 */
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid callback id' });
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ error: 'status is required' });

    const db = getDB();
    await db.collection('callbacks').updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } },
    );
    res.json({ success: true });
  } catch (err) {
    console.error('PATCH /callbacks/:id error:', err);
    res.status(500).json({ error: 'Failed to update callback' });
  }
});

module.exports = router;
