const express = require('express');
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { userIdDbMatch } = require('../lib/userIdDbMatch');

const router = express.Router();

const { ObjectId } = require('mongodb');

const SENT_TYPE_LABELS = {
  qr_or_bank: 'Bank/QR',
  transport_link: 'Logistics link',
  sample_pickup_link: 'Sample pickup',
  lc_credit: 'LC/Credit',
  testing_certificate: 'Testing cert',
  lab_report: 'Lab report',
};

/**
 * Sync sentToUser entries from user's orders into notifications (backfill for existing entries).
 */
async function syncSentToUserNotifications(db, userId) {
  const uid = String(userId);
  const idFilter = ObjectId.isValid(uid) ? { $or: [{ userId: uid }, { userId: new ObjectId(uid) }] } : { userId: uid };
  const orders = await db
    .collection('orders')
    .find({ ...idFilter, sentToUser: { $exists: true, $ne: [] } })
    .toArray();
  for (const order of orders) {
    const orderId = order._id.toString();
    const sentToUser = order.sentToUser || [];
    for (let i = 0; i < sentToUser.length; i++) {
      const item = sentToUser[i];
      const existing = await db.collection('notifications').findOne({
        userId: uid,
        'data.orderId': orderId,
        'data.sentIndex': i,
      });
      if (existing) continue;
      const typeLabel = SENT_TYPE_LABELS[item.type] || item.type || 'Link';
      const title = `${typeLabel}: ${item.label || 'New link'}`;
      const body = item.detail || item.label || 'Tap to view';
      await db.collection('notifications').insertOne({
        userId: uid,
        title,
        body,
        data: { orderId, linkType: item.type, detail: item.detail, label: item.label, sentIndex: i, channel: item.channel || 'App' },
        createdAt: new Date(),
      });
    }
  }
}

/**
 * GET /api/notifications
 * Returns notifications for the current user. Query: ?unreadOnly=1
 * Syncs sentToUser entries from orders so dashboard links appear in app.
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const uid = req.user.id;
    await syncSentToUserNotifications(db, uid);
    const userMatch = userIdDbMatch(uid);
    const filter =
      req.query.unreadOnly === '1' || req.query.unreadOnly === 'true'
        ? { $and: [userMatch, { readAt: { $exists: false } }] }
        : userMatch;
    const list = await db
      .collection('notifications')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    res.json(list.map((n) => ({
      id: n._id?.toString(),
      _id: n._id?.toString(),
      title: n.title,
      body: n.body,
      readAt: n.readAt,
      createdAt: n.createdAt,
      data: n.data || {},
    })));
  } catch (err) {
    console.error('GET /notifications error:', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

/**
 * GET /api/notifications/unread-count
 * For home dashboard badge (after syncing order links into notifications).
 */
router.get('/unread-count', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const uid = req.user.id;
    await syncSentToUserNotifications(db, uid);
    const unreadCount = await db.collection('notifications').countDocuments({
      $and: [userIdDbMatch(String(uid)), { readAt: { $exists: false } }],
    });
    res.json({ unreadCount });
  } catch (err) {
    console.error('GET /notifications/unread-count error:', err);
    res.status(500).json({ error: 'Failed to count notifications' });
  }
});

/**
 * POST /api/notifications
 * Body: { title, body?, data? }
 * Create a notification for the current user. If data.equipmentRequestId is set, insert is idempotent (one row per request id).
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { title, body, data } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });
    const db = getDB();
    const uid = String(req.user.id);
    let dataOut = null;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      dataOut = { ...data };
      const eqId = dataOut.equipmentRequestId != null ? String(dataOut.equipmentRequestId).trim() : '';
      if (eqId) {
        dataOut.equipmentRequestId = eqId;
        const existing = await db.collection('notifications').findOne({
          $and: [userIdDbMatch(uid), { 'data.equipmentRequestId': eqId }],
        });
        if (existing) {
          return res.status(200).json({
            id: existing._id.toString(),
            title: existing.title,
            createdAt: existing.createdAt,
            deduplicated: true,
          });
        }
      }
    }
    const doc = {
      userId: uid,
      title: String(title),
      body: body || '',
      createdAt: new Date(),
      ...(dataOut ? { data: dataOut } : {}),
    };
    const result = await db.collection('notifications').insertOne(doc);
    const inserted = await db.collection('notifications').findOne({ _id: result.insertedId });
    res.status(201).json({ id: inserted._id.toString(), title: inserted.title, createdAt: inserted.createdAt });
  } catch (err) {
    console.error('POST /notifications error:', err);
    res.status(500).json({ error: 'Failed to create notification' });
  }
});

/**
 * PATCH /api/notifications/read-all
 * Mark every notification for this user as read.
 */
router.patch('/read-all', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const uid = String(req.user.id);
    const now = new Date();
    const result = await db.collection('notifications').updateMany(
      { $and: [userIdDbMatch(uid), { readAt: { $exists: false } }] },
      { $set: { readAt: now } }
    );
    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (err) {
    console.error('PATCH /notifications/read-all error:', err);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

/**
 * DELETE /api/notifications/:id
 * Remove a notification for the current user.
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });
    const db = getDB();
    const uid = String(req.user.id);
    const result = await db.collection('notifications').deleteOne({
      $and: [{ _id: new ObjectId(id) }, userIdDbMatch(uid)],
    });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Notification not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /notifications/:id error:', err);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

/**
 * PATCH /api/notifications/:id/read
 * Mark notification as read.
 */
router.patch('/:id/read', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });
    const db = getDB();
    const uid = String(req.user.id);
    const result = await db.collection('notifications').updateOne(
      { $and: [{ _id: new ObjectId(id) }, userIdDbMatch(uid)] },
      { $set: { readAt: new Date() } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Notification not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('PATCH /notifications/:id/read error:', err);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

module.exports = router;
