const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/** Legacy rows have no usage field — treat as delivery (ship-to). Sell pickup uses usage: 'pickup'. */
function normalizeUsage(raw) {
  return raw === 'pickup' ? 'pickup' : 'delivery';
}

function usageMongoFilter(usage) {
  const u = normalizeUsage(usage);
  if (u === 'pickup') return { usage: 'pickup' };
  return { $or: [{ usage: 'delivery' }, { usage: { $exists: false } }, { usage: null }] };
}

/**
 * GET /api/addresses
 * Query: ?usage=delivery | ?usage=pickup — filter list. Omit query to return all (e.g. profile).
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const qUsage = req.query.usage;
    const base = { userId: req.user.id };
    const filter =
      qUsage === 'delivery' || qUsage === 'pickup'
        ? { ...base, ...usageMongoFilter(qUsage) }
        : base;
    const list = await db
      .collection('addresses')
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();
    res.json(
      list.map((a) => ({
        id: a._id.toString(),
        _id: a._id.toString(),
        label: a.label,
        facilityName: a.facilityName,
        street: a.street,
        city: a.city,
        state: a.state,
        stateRegion: a.state,
        country: a.country,
        postalCode: a.postalCode,
        phone: a.phone,
        email: a.email || '',
        countryCode: a.countryCode || null,
        institutionalPermitNumber: a.institutionalPermitNumber,
        proofOfFacilityUrl: a.proofOfFacilityUrl,
        regulatoryCompliance: a.regulatoryCompliance,
        isDefault: a.isDefault,
        usage: normalizeUsage(a.usage),
        createdAt: a.createdAt,
      }))
    );
  } catch (err) {
    console.error('GET /addresses error:', err);
    res.status(500).json({ error: 'Failed to fetch addresses' });
  }
});

/**
 * POST /api/addresses
 * Body: { label, facilityName?, street, city, state?, stateRegion?, country, postalCode?, phone?, email?, ... }
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      label,
      facilityName,
      street,
      city,
      state,
      stateRegion,
      country,
      postalCode,
      phone,
      email,
      countryCode,
      institutionalPermitNumber,
      proofOfFacilityUrl,
      regulatoryCompliance,
      isDefault,
      usage: usageRaw,
    } = req.body || {};
    if (!street || !city || !country) {
      return res.status(400).json({ error: 'street, city, and country are required' });
    }
    const db = getDB();
    const usage = normalizeUsage(usageRaw);
    const sameUsageScope = { userId: req.user.id, ...usageMongoFilter(usage) };
    const count = await db.collection('addresses').countDocuments(sameUsageScope);
    const doc = {
      userId: req.user.id,
      usage,
      label: label || 'Address',
      facilityName: facilityName || '',
      street,
      city,
      state: state || stateRegion || '',
      country,
      postalCode: postalCode || '',
      phone: phone || '',
      email: email || '',
      countryCode: countryCode || null,
      institutionalPermitNumber: institutionalPermitNumber || '',
      proofOfFacilityUrl: proofOfFacilityUrl || null,
      regulatoryCompliance: Boolean(regulatoryCompliance),
      isDefault: count === 0 || Boolean(isDefault),
      createdAt: new Date(),
    };
    if (doc.isDefault) {
      await db.collection('addresses').updateMany(sameUsageScope, { $set: { isDefault: false } });
    }
    const result = await db.collection('addresses').insertOne(doc);
    const inserted = await db.collection('addresses').findOne({ _id: result.insertedId });
    res.status(201).json({
      id: inserted._id.toString(),
      _id: inserted._id.toString(),
      label: inserted.label,
      facilityName: inserted.facilityName,
      street: inserted.street,
      city: inserted.city,
      state: inserted.state,
      country: inserted.country,
      postalCode: inserted.postalCode,
      phone: inserted.phone,
      email: inserted.email || '',
      countryCode: inserted.countryCode || null,
      institutionalPermitNumber: inserted.institutionalPermitNumber,
      proofOfFacilityUrl: inserted.proofOfFacilityUrl,
      regulatoryCompliance: inserted.regulatoryCompliance,
      isDefault: inserted.isDefault,
      usage: normalizeUsage(inserted.usage),
      createdAt: inserted.createdAt,
    });
  } catch (err) {
    console.error('POST /addresses error:', err);
    res.status(500).json({ error: 'Failed to create address' });
  }
});

/**
 * PATCH /api/addresses/:id
 */
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid address id' });
    const {
      label,
      facilityName,
      street,
      city,
      state,
      stateRegion,
      country,
      postalCode,
      phone,
      email,
      countryCode,
      institutionalPermitNumber,
      proofOfFacilityUrl,
      regulatoryCompliance,
      isDefault,
      usage: usageBody,
    } = req.body || {};
    const db = getDB();
    const updates = {};
    if (label !== undefined) updates.label = label;
    if (facilityName !== undefined) updates.facilityName = facilityName;
    if (street !== undefined) updates.street = street;
    if (city !== undefined) updates.city = city;
    if (state !== undefined) updates.state = state;
    else if (stateRegion !== undefined) updates.state = stateRegion;
    if (country !== undefined) updates.country = country;
    if (postalCode !== undefined) updates.postalCode = postalCode;
    if (phone !== undefined) updates.phone = phone;
    if (email !== undefined) updates.email = email;
    if (countryCode !== undefined) updates.countryCode = countryCode;
    if (institutionalPermitNumber !== undefined) updates.institutionalPermitNumber = institutionalPermitNumber;
    if (proofOfFacilityUrl !== undefined) updates.proofOfFacilityUrl = proofOfFacilityUrl;
    if (regulatoryCompliance !== undefined) updates.regulatoryCompliance = Boolean(regulatoryCompliance);
    if (usageBody !== undefined) updates.usage = normalizeUsage(usageBody);
    if (isDefault === true) {
      const existingForScope = await db.collection('addresses').findOne({ _id: new ObjectId(id), userId: req.user.id });
      if (!existingForScope) return res.status(404).json({ error: 'Address not found' });
      const scopeUsage = updates.usage !== undefined ? updates.usage : normalizeUsage(existingForScope.usage);
      const scope = { userId: req.user.id, ...usageMongoFilter(scopeUsage) };
      await db.collection('addresses').updateMany(scope, { $set: { isDefault: false } });
      updates.isDefault = true;
    }
    if (Object.keys(updates).length === 0) {
      const existing = await db.collection('addresses').findOne({ _id: new ObjectId(id), userId: req.user.id });
      if (!existing) return res.status(404).json({ error: 'Address not found' });
      return res.json({ id: existing._id.toString(), ...existing, usage: normalizeUsage(existing.usage) });
    }
    const result = await db
      .collection('addresses')
      .findOneAndUpdate(
        { _id: new ObjectId(id), userId: req.user.id },
        { $set: updates },
        { returnDocument: 'after' }
      );
    if (!result) return res.status(404).json({ error: 'Address not found' });
    const a = result;
    res.json({
      id: a._id.toString(),
      label: a.label,
      facilityName: a.facilityName,
      street: a.street,
      city: a.city,
      state: a.state,
      stateRegion: a.state,
      country: a.country,
      postalCode: a.postalCode,
      phone: a.phone,
      email: a.email || '',
      countryCode: a.countryCode || null,
      institutionalPermitNumber: a.institutionalPermitNumber,
      proofOfFacilityUrl: a.proofOfFacilityUrl,
      regulatoryCompliance: a.regulatoryCompliance,
      isDefault: a.isDefault,
      usage: normalizeUsage(a.usage),
      createdAt: a.createdAt,
    });
  } catch (err) {
    console.error('PATCH /addresses/:id error:', err);
    res.status(500).json({ error: 'Failed to update address' });
  }
});

/**
 * DELETE /api/addresses/:id
 * Remove address from list (Profile > Saved Addresses).
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid address id' });
    const db = getDB();
    const result = await db.collection('addresses').deleteOne({ _id: new ObjectId(id), userId: req.user.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Address not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /addresses/:id error:', err);
    res.status(500).json({ error: 'Failed to delete address' });
  }
});

module.exports = router;
