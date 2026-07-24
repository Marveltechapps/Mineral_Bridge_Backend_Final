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

function isNumericOnlyText(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return false;
  return !/[\p{L}]/u.test(trimmed);
}

function isAddressText(value, { min = 2, max = 120 } = {}) {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length < min || trimmed.length > max) return false;
  if (isNumericOnlyText(trimmed)) return false;
  return /^[\p{L}\p{M}0-9 .,'#/\-]+$/u.test(trimmed);
}

function isStreetAddress(value) {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length < 3 || trimmed.length > 200) return false;
  if (isNumericOnlyText(trimmed)) return false;
  return /[\p{L}]/u.test(trimmed);
}

function isPostalCode(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return false;
  const compact = normalized.replace(/[\s-]/g, '');
  return /^[A-Za-z0-9]{3,12}$/.test(compact);
}

function validateAddressBody(body, { partial = false } = {}) {
  const fields = {};
  const get = (key, alt) => (body[key] !== undefined ? body[key] : body[alt]);

  const label = body.label !== undefined ? String(body.label || '').trim() : undefined;
  const facilityName =
    body.facilityName !== undefined ? String(body.facilityName || '').trim() : undefined;
  const street = body.street !== undefined ? String(body.street || '').trim() : undefined;
  const city = body.city !== undefined ? String(body.city || '').trim() : undefined;
  const stateRaw = get('state', 'stateRegion');
  const state = stateRaw !== undefined ? String(stateRaw || '').trim() : undefined;
  const country = body.country !== undefined ? String(body.country || '').trim() : undefined;
  const postalCode = body.postalCode !== undefined ? String(body.postalCode || '').trim() : undefined;

  const requireField = (present, key, message) => {
    if (!partial || present !== undefined) {
      if (!present) fields[key] = message;
    }
  };

  if (!partial) {
    requireField(label, 'label', 'Label is required.');
    requireField(street, 'street', 'Street address is required.');
    requireField(city, 'city', 'City is required.');
    requireField(state, 'region', 'Region / state is required.');
    requireField(postalCode, 'postal', 'Postal code is required.');
    requireField(country, 'country', 'Country is required.');
  }

  if (label !== undefined && label && !isAddressText(label, { min: 2, max: 80 })) {
    fields.label = 'Enter a label with letters (not numbers only).';
  }
  if (facilityName !== undefined && facilityName && !isAddressText(facilityName, { min: 2, max: 120 })) {
    fields.facility = 'Facility name must include letters (not numbers only).';
  }
  if (street !== undefined && (!street || !isStreetAddress(street))) {
    fields.street = street
      ? 'Enter a street address with a name (not numbers only).'
      : 'Street address is required.';
  }
  if (city !== undefined && (!city || !isAddressText(city))) {
    fields.city = city ? 'Enter a valid city name (not numbers only).' : 'City is required.';
  }
  if (state !== undefined && (!state || !isAddressText(state))) {
    fields.region = state ? 'Enter a valid region or state (not numbers only).' : 'Region / state is required.';
  }
  if (postalCode !== undefined && (!postalCode || !isPostalCode(postalCode))) {
    fields.postal = postalCode
      ? 'Enter a valid postal code (3–12 letters or digits).'
      : 'Postal code is required.';
  }
  if (country !== undefined && (!country || !isAddressText(country))) {
    fields.country = country ? 'Enter a valid country name (not numbers only).' : 'Country is required.';
  }

  // Map region error key for API consumers that use `state`
  if (fields.region) fields.state = fields.region;

  return {
    fields,
    normalized: {
      label,
      facilityName,
      street,
      city,
      state,
      country,
      postalCode,
    },
  };
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
    const body = req.body || {};
    const { fields, normalized } = validateAddressBody(body, { partial: false });
    if (Object.keys(fields).length) {
      return res.status(400).json({ error: 'Validation failed', fields });
    }

    const {
      phone,
      email,
      countryCode,
      institutionalPermitNumber,
      proofOfFacilityUrl,
      regulatoryCompliance,
      isDefault,
      usage: usageRaw,
    } = body;

    const db = getDB();
    const usage = normalizeUsage(usageRaw);
    const sameUsageScope = { userId: req.user.id, ...usageMongoFilter(usage) };
    const count = await db.collection('addresses').countDocuments(sameUsageScope);
    const doc = {
      userId: req.user.id,
      usage,
      label: normalized.label || 'Address',
      facilityName: normalized.facilityName || '',
      street: normalized.street,
      city: normalized.city,
      state: normalized.state || '',
      country: normalized.country,
      postalCode: normalized.postalCode || '',
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
    const body = req.body || {};
    const {
      phone,
      email,
      countryCode,
      institutionalPermitNumber,
      proofOfFacilityUrl,
      regulatoryCompliance,
      isDefault,
      usage: usageBody,
    } = body;

    let normalizedAddress = null;
    if (addressFieldsProvided) {
      const { fields, normalized } = validateAddressBody(body, { partial: true });
      if (Object.keys(fields).length) {
        return res.status(400).json({ error: 'Validation failed', fields });
      }
      normalizedAddress = normalized;
    }

    const db = getDB();
    const updates = {};
    if (normalizedAddress) {
      if (body.label !== undefined) updates.label = normalizedAddress.label;
      if (body.facilityName !== undefined) updates.facilityName = normalizedAddress.facilityName;
      if (body.street !== undefined) updates.street = normalizedAddress.street;
      if (body.city !== undefined) updates.city = normalizedAddress.city;
      if (body.state !== undefined || body.stateRegion !== undefined) updates.state = normalizedAddress.state;
      if (body.country !== undefined) updates.country = normalizedAddress.country;
      if (body.postalCode !== undefined) updates.postalCode = normalizedAddress.postalCode;
    }
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
