const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/payment-methods
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const list = await db
      .collection('payment_methods')
      .find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(
      list.map((p) => ({
        id: p._id.toString(),
        type: p.type,
        holderName: p.holderName,
        bankName: p.bankName,
        accountNumber: p.accountNumber ? '****' + String(p.accountNumber).slice(-4) : null,
        swift: p.swift,
        label: p.label,
        network: p.network,
        address: p.address ? p.address.slice(0, 10) + '...' : null,
        verified: p.verified,
        createdAt: p.createdAt,
      }))
    );
  } catch (err) {
    console.error('GET /payment-methods error:', err);
    res.status(500).json({ error: 'Failed to fetch payment methods' });
  }
});

/**
 * POST /api/payment-methods
 * Body (Bank): { type: 'Bank', holderName, bankName, accountNumber, swift }
 * Body (Crypto): { type: 'Crypto', label, network, address }
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const type = body.type === 'Crypto' ? 'Crypto' : 'Bank';
    const db = getDB();
    const doc = {
      userId: req.user.id,
      type,
      verified: false,
      createdAt: new Date(),
    };
    if (type === 'Bank') {
      doc.holderName = body.holderName || '';
      doc.bankName = body.bankName || '';
      doc.accountNumber = body.accountNumber || '';
      doc.swift = body.swift || '';
    } else {
      doc.label = body.label || '';
      doc.network = body.network || '';
      doc.address = body.address || '';
    }
    const result = await db.collection('payment_methods').insertOne(doc);
    const inserted = await db.collection('payment_methods').findOne({ _id: result.insertedId });
    res.status(201).json({
      id: inserted._id.toString(),
      type: inserted.type,
      verified: inserted.verified,
      createdAt: inserted.createdAt,
    });
  } catch (err) {
    console.error('POST /payment-methods error:', err);
    res.status(500).json({ error: 'Failed to add payment method' });
  }
});

/**
 * GET /api/payment-methods/:id  — full (unmasked) details for editing
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });
    const db = getDB();
    const p = await db.collection('payment_methods').findOne({ _id: new ObjectId(id), userId: req.user.id });
    if (!p) return res.status(404).json({ error: 'Payment method not found' });
    res.json({
      id: p._id.toString(),
      type: p.type,
      holderName: p.holderName || '',
      bankName: p.bankName || '',
      accountNumber: p.accountNumber || '',
      swift: p.swift || '',
      label: p.label || '',
      network: p.network || '',
      address: p.address || '',
      verified: p.verified,
      createdAt: p.createdAt,
    });
  } catch (err) {
    console.error('GET /payment-methods/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch payment method' });
  }
});

/**
 * PUT /api/payment-methods/:id
 */
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });
    const db = getDB();
    const existing = await db.collection('payment_methods').findOne({ _id: new ObjectId(id), userId: req.user.id });
    if (!existing) return res.status(404).json({ error: 'Payment method not found' });
    const body = req.body || {};
    const update = { updatedAt: new Date() };
    if (existing.type === 'Bank') {
      if (body.holderName !== undefined) update.holderName = body.holderName;
      if (body.bankName !== undefined) update.bankName = body.bankName;
      if (body.accountNumber !== undefined) update.accountNumber = body.accountNumber;
      if (body.swift !== undefined) update.swift = body.swift;
    } else {
      if (body.label !== undefined) update.label = body.label;
      if (body.network !== undefined) update.network = body.network;
      if (body.address !== undefined) update.address = body.address;
    }
    await db.collection('payment_methods').updateOne({ _id: new ObjectId(id) }, { $set: update });
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /payment-methods/:id error:', err);
    res.status(500).json({ error: 'Failed to update payment method' });
  }
});

/**
 * DELETE /api/payment-methods/:id
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });
    const db = getDB();
    const result = await db.collection('payment_methods').deleteOne({ _id: new ObjectId(id), userId: req.user.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Payment method not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /payment-methods/:id error:', err);
    res.status(500).json({ error: 'Failed to remove payment method' });
  }
});

module.exports = router;
