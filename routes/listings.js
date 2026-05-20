const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/listings
 * Body: { mineralId, category?, quantity, unit?, type?, buyerType?, origin?, photos?[], documents?[], extractionDate?, ... }
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      mineralId,
      category,
      quantity,
      unit,
      type,
      buyerType,
      origin,
      photos,
      documents,
      extractionDate,
      originYear,
      targetBuyerType,
      verificationStatus,
      assayRequired,
      aiEstimatedPayout,
      escrowStatus,
      pickupMethod,
      pickupAddressId,
      sampleTestRequired,
      billOfSaleUrl,
    } = req.body || {};
    if (!mineralId || quantity == null) {
      return res.status(400).json({ error: 'mineralId and quantity are required' });
    }
    const db = getDB();
    const listing = {
      userId: req.user.id,
      mineralId: String(mineralId),
      category: category || '',
      quantity: Number(quantity) || 0,
      unit: unit || 'kg',
      type: type || 'raw',
      buyerType: buyerType || 'any',
      origin: origin || '',
      photos: Array.isArray(photos) ? photos : [],
      documents: Array.isArray(documents) ? documents : [],
      extractionDate: extractionDate || null,
      originYear: originYear || null,
      targetBuyerType: targetBuyerType || null,
      verificationStatus: verificationStatus || 'pending',
      assayRequired: Boolean(assayRequired),
      aiEstimatedPayout: aiEstimatedPayout != null ? Number(aiEstimatedPayout) : null,
      escrowStatus: escrowStatus || 'pending',
      pickupMethod: pickupMethod || 'Pickup',
      pickupAddressId: pickupAddressId || null,
      sampleTestRequired: Boolean(sampleTestRequired),
      billOfSaleUrl: billOfSaleUrl || null,
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await db.collection('listings').insertOne(listing);
    const inserted = await db.collection('listings').findOne({ _id: result.insertedId });
    res.status(201).json({
      id: inserted._id.toString(),
      _id: inserted._id.toString(),
      ...listing,
      _id: undefined,
    });
  } catch (err) {
    console.error('POST /listings error:', err);
    res.status(500).json({ error: 'Failed to create listing' });
  }
});

/**
 * GET /api/listings
 * Query: ?mine=1 (only current user), ?all=1 (dashboard: all listings; requires x-dashboard-key), ?status=...
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const filter = {};
    if (req.isDashboard && (req.query.all === '1' || req.query.all === 'true')) {
      // Dashboard: all listings
    } else {
      filter.userId = req.user.id;
    }
    if (req.query.status) filter.status = req.query.status;
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
    const list = await db
      .collection('listings')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    res.json(
      list.map((l) => ({
        id: l._id.toString(),
        _id: l._id.toString(),
        userId: l.userId,
        mineralId: l.mineralId,
        category: l.category,
        quantity: l.quantity,
        unit: l.unit,
        type: l.type,
        buyerType: l.buyerType,
        origin: l.origin,
        photos: l.photos || [],
        documents: l.documents || [],
        extractionDate: l.extractionDate,
        originYear: l.originYear,
        targetBuyerType: l.targetBuyerType,
        verificationStatus: l.verificationStatus,
        assayRequired: l.assayRequired,
        aiEstimatedPayout: l.aiEstimatedPayout,
        escrowStatus: l.escrowStatus,
        pickupMethod: l.pickupMethod,
        pickupAddressId: l.pickupAddressId,
        sampleTestRequired: l.sampleTestRequired,
        billOfSaleUrl: l.billOfSaleUrl,
        status: l.status,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt,
      }))
    );
  } catch (err) {
    console.error('GET /listings error:', err);
    res.status(500).json({ error: 'Failed to fetch listings' });
  }
});

/**
 * GET /api/listings/:id
 * App: owner only. Dashboard (x-dashboard-key): can get any.
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid listing id' });
    const db = getDB();
    const listing = await db.collection('listings').findOne({ _id: new ObjectId(id) });
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (!req.isDashboard && listing.userId !== req.user.id) return res.status(403).json({ error: 'Not your listing' });
    res.json({
      id: listing._id.toString(),
      _id: listing._id.toString(),
      userId: listing.userId,
      mineralId: listing.mineralId,
      category: listing.category,
      quantity: listing.quantity,
      unit: listing.unit,
      type: listing.type,
      buyerType: listing.buyerType,
      origin: listing.origin,
      photos: listing.photos || [],
      documents: listing.documents || [],
      extractionDate: listing.extractionDate,
      originYear: listing.originYear,
      targetBuyerType: listing.targetBuyerType,
      verificationStatus: listing.verificationStatus,
      assayRequired: listing.assayRequired,
      aiEstimatedPayout: listing.aiEstimatedPayout,
      escrowStatus: listing.escrowStatus,
      pickupMethod: listing.pickupMethod,
      pickupAddressId: listing.pickupAddressId,
      sampleTestRequired: listing.sampleTestRequired,
      billOfSaleUrl: listing.billOfSaleUrl,
      status: listing.status,
      createdAt: listing.createdAt,
      updatedAt: listing.updatedAt,
    });
  } catch (err) {
    console.error('GET /listings/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch listing' });
  }
});

/**
 * PATCH /api/listings/:id
 * App: owner only. Dashboard (x-dashboard-key): can update any listing (e.g. status).
 */
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid listing id' });
    const {
      status,
      quantity,
      unit,
      type,
      buyerType,
      origin,
      photos,
      documents,
      extractionDate,
      originYear,
      targetBuyerType,
      verificationStatus,
      assayRequired,
      aiEstimatedPayout,
      escrowStatus,
      pickupMethod,
      pickupAddressId,
      sampleTestRequired,
      billOfSaleUrl,
    } = req.body || {};
    const db = getDB();
    const updates = { updatedAt: new Date() };
    if (status !== undefined) updates.status = status;
    if (quantity !== undefined) updates.quantity = Number(quantity);
    if (unit !== undefined) updates.unit = unit;
    if (type !== undefined) updates.type = type;
    if (buyerType !== undefined) updates.buyerType = buyerType;
    if (origin !== undefined) updates.origin = origin;
    if (photos !== undefined) updates.photos = Array.isArray(photos) ? photos : [];
    if (documents !== undefined) updates.documents = Array.isArray(documents) ? documents : [];
    if (extractionDate !== undefined) updates.extractionDate = extractionDate;
    if (originYear !== undefined) updates.originYear = originYear;
    if (targetBuyerType !== undefined) updates.targetBuyerType = targetBuyerType;
    if (verificationStatus !== undefined) updates.verificationStatus = verificationStatus;
    if (assayRequired !== undefined) updates.assayRequired = Boolean(assayRequired);
    if (aiEstimatedPayout !== undefined) updates.aiEstimatedPayout = Number(aiEstimatedPayout);
    if (escrowStatus !== undefined) updates.escrowStatus = escrowStatus;
    if (pickupMethod !== undefined) updates.pickupMethod = pickupMethod;
    if (pickupAddressId !== undefined) updates.pickupAddressId = pickupAddressId;
    if (sampleTestRequired !== undefined) updates.sampleTestRequired = Boolean(sampleTestRequired);
    if (billOfSaleUrl !== undefined) updates.billOfSaleUrl = billOfSaleUrl;
    const filter = req.isDashboard ? { _id: new ObjectId(id) } : { _id: new ObjectId(id), userId: req.user.id };
    const result = await db
      .collection('listings')
      .findOneAndUpdate(filter, { $set: updates }, { returnDocument: 'after' });
    if (!result) return res.status(404).json({ error: 'Listing not found' });
    const l = result;
    res.json({
      id: l._id.toString(),
      status: l.status,
      quantity: l.quantity,
      unit: l.unit,
      type: l.type,
      buyerType: l.buyerType,
      origin: l.origin,
      photos: l.photos || [],
      documents: l.documents || [],
      extractionDate: l.extractionDate,
      originYear: l.originYear,
      targetBuyerType: l.targetBuyerType,
      verificationStatus: l.verificationStatus,
      assayRequired: l.assayRequired,
      aiEstimatedPayout: l.aiEstimatedPayout,
      escrowStatus: l.escrowStatus,
      pickupMethod: l.pickupMethod,
      pickupAddressId: l.pickupAddressId,
      sampleTestRequired: l.sampleTestRequired,
      billOfSaleUrl: l.billOfSaleUrl,
      updatedAt: l.updatedAt,
    });
  } catch (err) {
    console.error('PATCH /listings/:id error:', err);
    res.status(500).json({ error: 'Failed to update listing' });
  }
});

/**
 * DELETE /api/listings/:id
 * App: owner only. Dashboard: can delete any.
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid listing id' });
    const db = getDB();
    const filter = req.isDashboard ? { _id: new ObjectId(id) } : { _id: new ObjectId(id), userId: req.user.id };
    const result = await db.collection('listings').deleteOne(filter);
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Listing not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /listings/:id error:', err);
    res.status(500).json({ error: 'Failed to delete listing' });
  }
});

module.exports = router;
