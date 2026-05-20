const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { toOptionalNumber, resolveStockFieldsFromDocument } = require('../lib/mineralStockResolve');
const { invalidateArtisanalMineralCache } = require('../lib/artisanalMineralValidation');

const router = express.Router();

/** CDN thumbnail params for catalog images (aligned with master sheet / dashboard import). Idempotent. */
function appendCatalogImageParams(url) {
  if (url == null || typeof url !== 'string') return url;
  const trimmed = url.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.includes('w=400&q=60')) return trimmed;
  // Avoid breaking signed URLs (S3/Firebase/GCS/CloudFront tokens etc.).
  // Adding query params can invalidate the signature and make images disappear.
  const lower = trimmed.toLowerCase();
  const looksSigned =
    lower.includes('x-amz-signature=') ||
    lower.includes('x-amz-credential=') ||
    lower.includes('x-amz-algorithm=') ||
    lower.includes('x-amz-date=') ||
    lower.includes('x-amz-security-token=') ||
    lower.includes('signature=') ||
    lower.includes('googleaccessid=') ||
    lower.includes('expires=') ||
    lower.includes('token=');
  if (looksSigned) return trimmed;
  const hashIdx = trimmed.indexOf('#');
  const base = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed;
  const hash = hashIdx >= 0 ? trimmed.slice(hashIdx) : '';
  const joiner = base.includes('?') ? '&' : '?';
  return `${base}${joiner}w=400&q=60${hash}`;
}

/** Normalize availability for JSON (dashboard + app expect { enabled, quantity?, unit? }). */
function normalizeAvailabilityForApi(av) {
  if (av == null) return av;
  if (typeof av === 'string') {
    const s = av.trim();
    return s || undefined;
  }
  if (typeof av !== 'object' || Array.isArray(av)) return av;
  const enabled =
    av.enabled === true ||
    av.enabled === 'true' ||
    av.enabled === 1 ||
    av.enabled === '1';
  const q = toOptionalNumber(av.quantity);
  const unit = av.unit != null && String(av.unit).trim() ? String(av.unit).trim() : undefined;
  return {
    ...av,
    enabled,
    ...(q !== undefined ? { quantity: q } : {}),
    ...(unit !== undefined ? { unit } : {}),
  };
}

/** Map DB document to API response (used by GET list, GET by id, POST, PATCH). Diamond screen & dashboard use this shape. */
function mapMineral(m) {
  if (!m) return null;
  const rawImage = m.imageUrl || m.image;
  const imageVal = rawImage ? appendCatalogImageParams(String(rawImage)) : rawImage;
  const out = {
    id: m.id || (m._id && m._id.toString()),
    name: m.name,
    category: m.category,
    subCategory: m.subCategory != null ? String(m.subCategory) : '',
    image: imageVal,
    imageUrl: imageVal,
    price: m.priceDisplay || m.price,
    description: m.description,
    subProductDescription: m.subProductDescription,
    origin: m.origin,
    purity: m.purity,
    unit: m.unit,
  };
  if (Array.isArray(m.mineralTypes)) out.mineralTypes = m.mineralTypes;
  if (Array.isArray(m.institutionalBuyerCategories)) {
    out.institutionalBuyerCategories = m.institutionalBuyerCategories;
  }
  if (m.blockchainProof != null) out.blockchainProof = m.blockchainProof;
  if (m.marketInsights != null) out.marketInsights = m.marketInsights;
  /** Limited availability: string or object { enabled, quantity, unit } — always normalize so app receives booleans/numbers. */
  if (m.availability != null) {
    const norm = normalizeAvailabilityForApi(m.availability);
    if (norm !== undefined) out.availability = norm;
  }

  /** Resolved stock for app (same rules as DB bulk-normalize + POST/PATCH persistence). */
  const mergedForResolve = { ...m, availability: out.availability !== undefined ? out.availability : m.availability };
  const stock = resolveStockFieldsFromDocument(mergedForResolve);
  if (stock) {
    out.availableQuantity = stock.availableQuantity;
    out.availableQuantityUnit = stock.availableQuantityUnit;
  }

  const minA = toOptionalNumber(m.minAllocation);
  if (minA !== undefined) out.minAllocation = minA;
  if (m.minAllocationUnit != null) out.minAllocationUnit = String(m.minAllocationUnit);
  /** Units allowed for this mineral (e.g. ["g", "ct", "kg"]). Empty/missing = all four (ct, g, kg, MT). */
  const VALID_UNITS = ['ct', 'g', 'kg', 'MT'];
  if (Array.isArray(m.allowedUnits) && m.allowedUnits.length > 0) {
    out.allowedUnits = m.allowedUnits
      .map((u) => String(u).trim())
      .filter((u) => VALID_UNITS.includes(u));
    if (out.allowedUnits.length === 0) out.allowedUnits = VALID_UNITS;
  }
  /** Dashboard → app Buy flow: when true, mineral appears in app Buy list. Omitted = true. */
  out.availableForBuy = m.availableForBuy !== false;
  /** Dashboard → app Sell flow: when true, mineral appears in app Sell list. Omitted = true. */
  out.availableForSell = m.availableForSell !== false;
  if (m.verificationStatus != null && ['Verified', 'Pending', 'Rejected'].includes(String(m.verificationStatus))) {
    out.verificationStatus = String(m.verificationStatus);
  }
  if (m.sortOrder != null && typeof m.sortOrder === 'number') out.sortOrder = m.sortOrder;
  return out;
}

/**
 * GET /api/minerals
 * Returns minerals for Buy/Sell marketplace.
 * Optional: ?category=Precious Metals
 * Optional: ?forBuy=1 – only minerals available for app Buy flow (dashboard → app).
 * Optional: ?forSell=1 – only minerals available for app Sell flow (dashboard → app).
 */
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const collection = db.collection('minerals');
    const category = req.query.category || null;
    const forBuy = req.query.forBuy === '1' || req.query.forBuy === 'true';
    const forSell = req.query.forSell === '1' || req.query.forSell === 'true';

    const andParts = [];
    if (forBuy) {
      andParts.push({ $or: [{ availableForBuy: true }, { availableForBuy: { $exists: false } }] });
    }
    if (forSell) {
      andParts.push({ $or: [{ availableForSell: true }, { availableForSell: { $exists: false } }] });
    }
    if (category) {
      const cat = String(category).trim();
      if (cat === 'Energy & Strategic' || /energy\s*&\s*strategic/i.test(cat)) {
        andParts.push({ $or: [{ category: 'Energy & Strategic' }, { category: 'Energy & Strategic Minerals' }] });
      } else {
        const re = new RegExp('^' + cat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
        andParts.push({ category: re });
      }
    }
    const filter = andParts.length > 0 ? { $and: andParts } : {};

    // Preserve Master Sheet order: sort by sortOrder (asc, nulls last), then name.
    // Also dedupe by name (case-insensitive) so accidental duplicates like "Sulphur" and "sulphur"
    // don't render twice in the mobile app (Buy and Sell lists).
    const pipeline = [
      { $match: filter },
      {
        $addFields: {
          _sortKey: { $ifNull: ['$sortOrder', 999999] },
          _nameKey: {
            $toLower: {
              $trim: { input: { $ifNull: ['$name', ''] } },
            },
          },
        },
      },
      // Sort so the "first" per nameKey is stable and matches catalog order
      { $sort: { _sortKey: 1, _nameKey: 1, name: 1 } },
      // Group by normalized name and pick the first document
      { $group: { _id: '$_nameKey', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
      // Re-sort after grouping (Mongo grouping breaks order)
      { $sort: { _sortKey: 1, name: 1 } },
      { $project: { _sortKey: 0, _nameKey: 0 } },
    ];
    const minerals = await collection.aggregate(pipeline).toArray();
    const list = minerals.map(mapMineral);
    res.json(list);
  } catch (err) {
    console.error('GET /api/minerals error:', err);
    res.status(500).json({ error: 'Failed to fetch minerals' });
  }
});

/**
 * GET /api/minerals/:id
 * Returns a single mineral by id (for Buy flow Mineral Detail – origin, purity, description, etc.).
 * Dashboard can use this to fetch one mineral for editing; diamond screen uses it for display.
 */
router.get('/:id', async (req, res) => {
  try {
    const mineral = await findMineralById(req.params.id);
    if (!mineral) return res.status(404).json({ error: 'Mineral not found' });
    res.json(mapMineral(mineral));
  } catch (err) {
    console.error('GET /api/minerals/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch mineral' });
  }
});

/** Resolve mineral by _id, string id, or name (case-insensitive). */
async function findMineralById(id) {
  const db = getDB();
  const collection = db.collection('minerals');
  if (ObjectId.isValid(id) && String(new ObjectId(id)) === id) {
    const byId = await collection.findOne({ _id: new ObjectId(id) });
    if (byId) return byId;
  }
  return collection.findOne({
    $or: [
      { id: id },
      { name: new RegExp('^' + String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') },
    ],
  });
}

/**
 * POST /api/minerals
 * Create a mineral. Body: { id?, name, category?, imageUrl?, image?, priceDisplay?, price?, description?, origin?, purity?, unit?, blockchainProof?, marketInsights?, availability? }
 * Dashboard uses this to add minerals; diamond screen then gets data via GET /api/minerals/:id.
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const name = body.name && String(body.name).trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const db = getDB();
    const collection = db.collection('minerals');
    const id = body.id && String(body.id).trim() ? body.id : name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const existing = await collection.findOne({ $or: [{ id }, { name: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }] });
    if (existing) return res.status(409).json({ error: 'Mineral with this id or name already exists' });

    const doc = {
      id,
      name,
      category: body.category != null ? String(body.category) : '',
      subCategory: body.subCategory != null ? String(body.subCategory) : '',
      imageUrl: body.imageUrl != null ? String(body.imageUrl) : body.image != null ? String(body.image) : null,
      image: body.image != null ? String(body.image) : body.imageUrl != null ? String(body.imageUrl) : null,
      priceDisplay: body.priceDisplay != null ? body.priceDisplay : body.price != null ? body.price : null,
      price: body.price != null ? body.price : body.priceDisplay != null ? body.priceDisplay : null,
      description: body.description != null ? String(body.description) : '',
      subProductDescription: body.subProductDescription != null ? String(body.subProductDescription) : '',
      origin: body.origin != null ? String(body.origin) : '',
      purity: body.purity != null ? String(body.purity) : '',
      unit: body.unit != null ? String(body.unit) : null,
      availableForBuy: body.availableForBuy !== false,
      availableForSell: body.availableForSell !== false,
    };
    if (body.sortOrder != null && typeof body.sortOrder === 'number') doc.sortOrder = body.sortOrder;
    if (Array.isArray(body.mineralTypes)) {
      doc.mineralTypes = body.mineralTypes.map((v) => String(v));
    }
    if (Array.isArray(body.institutionalBuyerCategories)) {
      doc.institutionalBuyerCategories = body.institutionalBuyerCategories.map((v) => String(v));
    }
    if (body.blockchainProof != null) doc.blockchainProof = body.blockchainProof;
    if (body.marketInsights != null) doc.marketInsights = body.marketInsights;
    if (body.availability != null) {
      const norm = normalizeAvailabilityForApi(body.availability);
      if (norm !== undefined) doc.availability = norm;
    }
    const aqPost = toOptionalNumber(body.availableQuantity);
    if (aqPost !== undefined) doc.availableQuantity = aqPost;
    if (body.availableQuantityUnit != null) doc.availableQuantityUnit = String(body.availableQuantityUnit);
    const minPost = toOptionalNumber(body.minAllocation);
    if (minPost !== undefined) doc.minAllocation = minPost;
    if (body.minAllocationUnit != null) doc.minAllocationUnit = String(body.minAllocationUnit);
    const validUnits = ['ct', 'g', 'kg', 'MT'];
    if (Array.isArray(body.allowedUnits) && body.allowedUnits.length > 0) {
      doc.allowedUnits = body.allowedUnits
        .map((u) => String(u).trim())
        .filter((u) => validUnits.includes(u));
    }

    const stockNew = resolveStockFieldsFromDocument(doc);
    if (stockNew) {
      doc.availableQuantity = stockNew.availableQuantity;
      doc.availableQuantityUnit = stockNew.availableQuantityUnit;
    }

    if (body.verificationStatus != null && ['Verified', 'Pending', 'Rejected'].includes(String(body.verificationStatus))) {
      doc.verificationStatus = String(body.verificationStatus);
    } else {
      doc.verificationStatus = 'Verified';
    }
    if (doc.imageUrl) doc.imageUrl = appendCatalogImageParams(String(doc.imageUrl));
    if (doc.image) doc.image = appendCatalogImageParams(String(doc.image));

    const { insertedId } = await collection.insertOne(doc);
    const inserted = await collection.findOne({ _id: insertedId });
    invalidateArtisanalMineralCache();
    res.status(201).json(mapMineral(inserted));
  } catch (err) {
    console.error('POST /api/minerals error:', err);
    res.status(500).json({ error: 'Failed to create mineral' });
  }
});

/**
 * DELETE /api/minerals/clear
 * Removes all minerals from the catalog. Dashboard uses this to clear old data before re-import.
 * Requires auth.
 */
router.delete('/clear', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('minerals').deleteMany({});
    invalidateArtisanalMineralCache();
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (err) {
    console.error('DELETE /api/minerals/clear error:', err);
    res.status(500).json({ error: 'Failed to clear minerals' });
  }
});

/**
 * PATCH /api/minerals/bulk-verification
 * Set verificationStatus for all minerals. Body: { verificationStatus: "Verified" | "Pending" | "Rejected" }.
 * Dashboard uses this to bulk-verify the catalog.
 */
router.patch('/bulk-verification', authMiddleware, async (req, res) => {
  try {
    const status = req.body && req.body.verificationStatus;
    if (!status || !['Verified', 'Pending', 'Rejected'].includes(String(status))) {
      return res.status(400).json({ error: 'verificationStatus must be Verified, Pending, or Rejected' });
    }
    const onlyPending = req.body && req.body.onlyPending === true;
    const db = getDB();
    const filter =
      onlyPending && String(status) === 'Verified'
        ? { $or: [{ verificationStatus: 'Pending' }, { verificationStatus: { $exists: false } }, { verificationStatus: null }] }
        : {};
    const result = await db.collection('minerals').updateMany(filter, { $set: { verificationStatus: String(status) } });
    invalidateArtisanalMineralCache();
    res.json({ success: true, modifiedCount: result.modifiedCount, matchedCount: result.matchedCount });
  } catch (err) {
    console.error('PATCH /api/minerals/bulk-verification error:', err);
    res.status(500).json({ error: 'Failed to update verification status' });
  }
});

/**
 * PATCH /api/minerals/bulk-normalize-stock
 * Writes resolved availableQuantity + availableQuantityUnit on every mineral (import / legacy rows).
 * Run once after deploy or from dashboard "Sync stock for app". Must be registered before /:id.
 */
router.patch('/bulk-normalize-stock', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const collection = db.collection('minerals');
    const all = await collection.find({}).toArray();
    let modifiedCount = 0;
    for (const m of all) {
      const stock = resolveStockFieldsFromDocument(m);
      if (!stock) continue;
      const curQ = toOptionalNumber(m.availableQuantity);
      const curU = m.availableQuantityUnit != null ? String(m.availableQuantityUnit).trim() : '';
      if (curQ === stock.availableQuantity && curU === String(stock.availableQuantityUnit)) continue;
      await collection.updateOne(
        { _id: m._id },
        { $set: { availableQuantity: stock.availableQuantity, availableQuantityUnit: stock.availableQuantityUnit } }
      );
      modifiedCount += 1;
    }
    res.json({
      success: true,
      matchedCount: all.length,
      modifiedCount,
      message: 'Stock fields normalized for mobile app display',
    });
  } catch (err) {
    console.error('PATCH /api/minerals/bulk-normalize-stock error:', err);
    res.status(500).json({ error: 'Failed to normalize mineral stock' });
  }
});

/**
 * PATCH /api/minerals/:id
 * Update a mineral. Body: same fields as POST (all optional).
 * Dashboard uses this to edit; diamond screen gets updated data via GET /api/minerals/:id.
 */
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const mineral = await findMineralById(req.params.id);
    if (!mineral) return res.status(404).json({ error: 'Mineral not found' });

    const body = req.body || {};
    const updates = {};
    if (body.id != null) {
      const newId = String(body.id).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      if (newId && newId !== mineral.id) {
        const db = getDB();
        const existingId = await db.collection('minerals').findOne({ id: newId });
        if (existingId) return res.status(409).json({ error: 'Another mineral already has this ID' });
        updates.id = newId;
      }
    }
    if (body.name != null) updates.name = String(body.name).trim();
    if (body.category != null) updates.category = String(body.category);
    if (body.subCategory != null) updates.subCategory = String(body.subCategory);
    if (body.imageUrl != null) updates.imageUrl = appendCatalogImageParams(String(body.imageUrl));
    if (body.image != null) updates.image = appendCatalogImageParams(String(body.image));
    if (body.priceDisplay != null) updates.priceDisplay = body.priceDisplay;
    if (body.price != null) updates.price = body.price;
    if (body.description != null) updates.description = String(body.description);
    if (body.subProductDescription != null) updates.subProductDescription = String(body.subProductDescription);
    if (body.origin != null) updates.origin = String(body.origin);
    if (body.purity != null) updates.purity = String(body.purity);
    if (body.unit != null) updates.unit = body.unit;
    if (body.mineralTypes !== undefined) {
      updates.mineralTypes = Array.isArray(body.mineralTypes)
        ? body.mineralTypes.map((v) => String(v))
        : [];
    }
    if (body.institutionalBuyerCategories !== undefined) {
      updates.institutionalBuyerCategories = Array.isArray(body.institutionalBuyerCategories)
        ? body.institutionalBuyerCategories.map((v) => String(v))
        : [];
    }
    if (body.blockchainProof !== undefined) updates.blockchainProof = body.blockchainProof;
    if (body.marketInsights !== undefined) updates.marketInsights = body.marketInsights;
    if (body.availability !== undefined) {
      updates.availability =
        body.availability == null ? null : normalizeAvailabilityForApi(body.availability);
    }
    if (body.availableQuantity !== undefined) {
      if (body.availableQuantity === null) {
        updates.availableQuantity = null;
      } else {
        const n = toOptionalNumber(body.availableQuantity);
        if (n !== undefined) updates.availableQuantity = n;
      }
    }
    if (body.availableQuantityUnit !== undefined) updates.availableQuantityUnit = String(body.availableQuantityUnit);
    if (body.minAllocation !== undefined) {
      if (body.minAllocation === null) {
        updates.minAllocation = null;
      } else {
        const n = toOptionalNumber(body.minAllocation);
        if (n !== undefined) updates.minAllocation = n;
      }
    }
    if (body.minAllocationUnit !== undefined) updates.minAllocationUnit = String(body.minAllocationUnit);
    const validUnits = ['ct', 'g', 'kg', 'MT'];
    if (body.allowedUnits !== undefined) {
      updates.allowedUnits = Array.isArray(body.allowedUnits) && body.allowedUnits.length > 0
        ? body.allowedUnits.map((u) => String(u).trim()).filter((u) => validUnits.includes(u))
        : [];
    }
    if (body.availableForBuy !== undefined) updates.availableForBuy = body.availableForBuy === true;
    if (body.availableForSell !== undefined) updates.availableForSell = body.availableForSell === true;
    if (body.verificationStatus !== undefined && ['Verified', 'Pending', 'Rejected'].includes(String(body.verificationStatus))) {
      updates.verificationStatus = String(body.verificationStatus);
    }
    if (body.sortOrder !== undefined) updates.sortOrder = typeof body.sortOrder === 'number' ? body.sortOrder : null;

    /**
     * Always persist resolved availableQuantity + unit from merged state (limited availability wins, then catalog).
     * Ensures dashboard edits (allocation, limited toggle, min allocation-only saves) update DB without bulk-normalize.
     * mapMineral() already exposes the same rules to GET; this keeps writes aligned so the app and DB stay in sync.
     */
    const mergedForStock = { ...mineral, ...updates };
    const stockM = resolveStockFieldsFromDocument(mergedForStock);
    if (stockM) {
      updates.availableQuantity = stockM.availableQuantity;
      updates.availableQuantityUnit = stockM.availableQuantityUnit;
    }

    if (Object.keys(updates).length === 0) {
      return res.json(mapMineral(mineral));
    }

    const db = getDB();
    const collection = db.collection('minerals');
    await collection.updateOne({ _id: mineral._id }, { $set: updates });
    const updated = await collection.findOne({ _id: mineral._id });
    if (updates.name != null) invalidateArtisanalMineralCache();
    res.json(mapMineral(updated));
  } catch (err) {
    console.error('PATCH /api/minerals/:id error:', err);
    res.status(500).json({ error: 'Failed to update mineral' });
  }
});

/**
 * DELETE /api/minerals/:id
 * Dashboard uses this to remove a mineral from the catalog.
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const mineral = await findMineralById(req.params.id);
    if (!mineral) return res.status(404).json({ error: 'Mineral not found' });
    const db = getDB();
    await db.collection('minerals').deleteOne({ _id: mineral._id });
    invalidateArtisanalMineralCache();
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/minerals/:id error:', err);
    res.status(500).json({ error: 'Failed to delete mineral' });
  }
});

module.exports = router;
