const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/transactions
 * Query: ?type=Buy|Sell&status=...&limit=50
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const filter = { userId: req.user.id };
    if (req.query.type === 'Buy' || req.query.type === 'Sell') filter.type = req.query.type;
    if (req.query.status) filter.status = req.query.status;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const list = await db
      .collection('transactions')
      .find(filter)
      .sort({ date: -1, createdAt: -1 })
      .limit(limit)
      .toArray();
    res.json(
      list.map((t) => ({
        id: t._id.toString(),
        orderId: t.orderId,
        type: t.type,
        itemName: t.itemName,
        date: t.date,
        status: t.status,
        subtotal: t.subtotal,
        serviceFee: t.serviceFee,
        networkFee: t.networkFee,
        total: t.total,
        invoiceUrl: t.invoiceUrl,
        createdAt: t.createdAt,
      }))
    );
  } catch (err) {
    console.error('GET /transactions error:', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

/**
 * GET /api/transactions/:id
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });
    const db = getDB();
    const t = await db.collection('transactions').findOne({ _id: new ObjectId(id), userId: req.user.id });
    if (!t) return res.status(404).json({ error: 'Transaction not found' });
    res.json({
      id: t._id.toString(),
      orderId: t.orderId,
      type: t.type,
      itemName: t.itemName,
      date: t.date,
      status: t.status,
      subtotal: t.subtotal,
      serviceFee: t.serviceFee,
      networkFee: t.networkFee,
      total: t.total,
      invoiceUrl: t.invoiceUrl,
      createdAt: t.createdAt,
    });
  } catch (err) {
    console.error('GET /transactions/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch transaction' });
  }
});

/**
 * POST /api/transactions
 * Internal: create transaction from order (or call from order completion). Body: { orderId, type, itemName, subtotal, serviceFee?, networkFee?, total, invoiceUrl? }
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { orderId, type, itemName, subtotal, serviceFee, networkFee, total, invoiceUrl } = req.body || {};
    if (!orderId || !type || !itemName || total == null) {
      return res.status(400).json({ error: 'orderId, type, itemName, and total are required' });
    }
    const db = getDB();
    const now = new Date();
    const doc = {
      userId: req.user.id,
      orderId: String(orderId),
      type: type === 'Sell' ? 'Sell' : 'Buy',
      itemName: String(itemName),
      date: now,
      status: 'Completed',
      subtotal: Number(subtotal) || 0,
      serviceFee: Number(serviceFee) || 0,
      networkFee: Number(networkFee) || 0,
      total: Number(total),
      invoiceUrl: invoiceUrl || null,
      createdAt: now,
    };
    const result = await db.collection('transactions').insertOne(doc);
    const inserted = await db.collection('transactions').findOne({ _id: result.insertedId });
    res.status(201).json({
      id: inserted._id.toString(),
      orderId: inserted.orderId,
      type: inserted.type,
      itemName: inserted.itemName,
      status: inserted.status,
      total: inserted.total,
      date: inserted.date,
    });
  } catch (err) {
    console.error('POST /transactions error:', err);
    res.status(500).json({ error: 'Failed to create transaction' });
  }
});

module.exports = router;
