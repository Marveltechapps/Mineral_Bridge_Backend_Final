const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const SWIFT_RE = /^[A-Za-z]{4}[A-Za-z]{2}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$/;
const ACCOUNT_RE = /^\d{6,34}$/;
const HOLDER_RE = /^[\p{L}\p{M} .'-]+$/u;
const TRC20_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;

function normalizeAccountNumber(value) {
  return String(value ?? '').replace(/[\s-]/g, '');
}

function validateBankBody(body) {
  const fields = {};
  const holderName = String(body.holderName || '').trim();
  const bankName = String(body.bankName || '').trim();
  const accountNumber = normalizeAccountNumber(body.accountNumber);
  const swift = String(body.swift || '').trim().toUpperCase();

  if (!holderName) fields.holderName = 'Account holder name is required.';
  else if (holderName.length < 2) fields.holderName = 'Enter the full account holder name.';
  else if (!HOLDER_RE.test(holderName)) fields.holderName = 'Name may only include letters, spaces, and . \' -';

  if (!bankName) fields.bankName = 'Bank name is required.';
  else if (bankName.length < 2) fields.bankName = 'Enter a valid bank name.';

  if (!accountNumber) fields.accountNumber = 'Account number is required.';
  else if (!ACCOUNT_RE.test(accountNumber)) fields.accountNumber = 'Enter a valid account number (6–34 digits).';

  if (swift && !SWIFT_RE.test(swift)) {
    fields.swift = 'Enter a valid SWIFT/BIC (8 or 11 characters), or leave blank.';
  }

  return {
    fields,
    normalized: { holderName, bankName, accountNumber, swift },
  };
}

function validateCryptoBody(body) {
  const fields = {};
  const label = String(body.label || '').trim();
  const network = String(body.network || '').trim();
  const address = String(body.address || '').trim();

  if (!label) fields.label = 'Wallet label is required.';
  else if (label.length < 2) fields.label = 'Enter a wallet label.';

  if (!network) fields.network = 'Select a network.';

  if (!address) fields.address = 'Wallet address is required.';
  else if (network.toUpperCase() === 'TRC-20' && !TRC20_RE.test(address)) {
    fields.address = 'Enter a valid TRC-20 address.';
  } else if (['ERC-20', 'BEP-20'].includes(network.toUpperCase()) && !EVM_RE.test(address)) {
    fields.address = `Enter a valid ${network} address.`;
  } else if (address.length < 20) {
    fields.address = 'Enter a valid wallet address.';
  }

  return {
    fields,
    normalized: { label, network, address },
  };
}

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
      // New methods stay unverified until 2FA / ops confirmation (required for withdrawals).
      verified: false,
      createdAt: new Date(),
    };

    if (type === 'Bank') {
      const { fields, normalized } = validateBankBody(body);
      if (Object.keys(fields).length) {
        return res.status(400).json({ error: 'Validation failed', fields });
      }

      const duplicate = await db.collection('payment_methods').findOne({
        userId: req.user.id,
        type: 'Bank',
        accountNumber: normalized.accountNumber,
      });
      if (duplicate) {
        return res.status(409).json({
          error: 'This bank account is already linked to your profile.',
          fields: { accountNumber: 'This account number is already linked.' },
        });
      }

      doc.holderName = normalized.holderName;
      doc.bankName = normalized.bankName;
      doc.accountNumber = normalized.accountNumber;
      doc.swift = normalized.swift;
    } else {
      const { fields, normalized } = validateCryptoBody(body);
      if (Object.keys(fields).length) {
        return res.status(400).json({ error: 'Validation failed', fields });
      }

      const duplicate = await db.collection('payment_methods').findOne({
        userId: req.user.id,
        type: 'Crypto',
        address: normalized.address,
      });
      if (duplicate) {
        return res.status(409).json({
          error: 'This wallet address is already linked to your profile.',
          fields: { address: 'This wallet address is already linked.' },
        });
      }

      doc.label = normalized.label;
      doc.network = normalized.network;
      doc.address = normalized.address;
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
