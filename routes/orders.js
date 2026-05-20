const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { resolveStockStateFromDocument } = require('../lib/mineralStockResolve');
const { resolveConfirmedPriceForApi } = require('../lib/orderPricing');
const { buildTransactionFromOrder } = require('../lib/transactions');

const router = express.Router();

const ORDER_STEPS = ['Submitted', 'Contact', 'Sample/Price', 'Logistics', 'Complete'];

function generateOrderId() {
  const n = Math.floor(10000 + Math.random() * 90000);
  return `MB-ORDER-${n}`;
}

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

function roundStockQuantity(n) {
  return Math.round(n * 1000000) / 1000000;
}

function buildMineralStockUpdate(mineral, orderedQty, orderedUnit) {
  const stock = resolveStockStateFromDocument(mineral);
  if (!stock) return null;

  const stockUnit = stock.availableQuantityUnit ? String(stock.availableQuantityUnit).trim() : '';
  const requestedUnit = orderedUnit != null ? String(orderedUnit).trim() : '';
  if (stockUnit && requestedUnit && stockUnit !== requestedUnit) {
    return {
      error: `This mineral is available in ${stockUnit} only. Please place the order in ${stockUnit}.`,
      status: 400,
    };
  }

  if (stock.availableQuantity <= 0) {
    return {
      error: `${mineral.name || 'This mineral'} is currently out of stock.`,
      status: 409,
    };
  }

  if (orderedQty > stock.availableQuantity) {
    return {
      error: `Only ${stock.availableQuantity} ${stockUnit || 'units'} is available right now.`,
      status: 409,
    };
  }

  const remaining = roundStockQuantity(stock.availableQuantity - orderedQty);
  const filter = { _id: mineral._id };
  const updates = {
    availableQuantity: remaining,
    availableQuantityUnit: stock.availableQuantityUnit,
  };

  if (stock.source === 'limited' || stock.source === 'availability') {
    const rawAvailability =
      mineral.availability && typeof mineral.availability === 'object' && !Array.isArray(mineral.availability)
        ? mineral.availability
        : {};
    filter['availability.quantity'] = rawAvailability.quantity;
    updates['availability.quantity'] = remaining;
    if (stock.source === 'limited') {
      filter['availability.enabled'] = rawAvailability.enabled;
    }
  } else if (stock.source === 'catalog') {
    filter.availableQuantity = mineral.availableQuantity;
  }

  return { filter, updates };
}

/**
 * POST /api/orders
 * Body: { mineralId, mineralName?, quantity, amount?, addressId, type?, listingId?, mineralType?, ... }
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      mineralId,
      mineralName,
      quantity,
      amount,
      addressId,
      type = 'buy',
      listingId,
      mineralType,
      buyerCategory,
      deliveryMethod,
      subtotal,
      transportFee,
      feePercent,
      totalDue,
      unit,
      estimatedPayout,
      originLocation,
      origin,
      extractionDate,
      extractionYear,
      sellPhotos,
      photos,
    } = req.body || {};
    if (!mineralId || !quantity || !addressId) {
      return res.status(400).json({ error: 'mineralId, quantity, and addressId are required' });
    }
    const orderedQty = Number(quantity);
    if (!Number.isFinite(orderedQty) || orderedQty <= 0) {
      return res.status(400).json({ error: 'quantity must be greater than 0' });
    }
    const mineral = await findMineralById(String(mineralId));
    if (!mineral) return res.status(404).json({ error: 'Mineral not found' });

    const db = getDB();
    const stockUpdate = buildMineralStockUpdate(mineral, orderedQty, unit);
    if (stockUpdate && stockUpdate.error) {
      return res.status(stockUpdate.status || 400).json({ error: stockUpdate.error });
    }
    if (stockUpdate) {
      const stockWrite = await db
        .collection('minerals')
        .updateOne(stockUpdate.filter, { $set: { ...stockUpdate.updates, updatedAt: new Date() } });
      if (stockWrite.matchedCount === 0 || stockWrite.modifiedCount === 0) {
        return res.status(409).json({ error: 'Available quantity changed. Please refresh and try again.' });
      }
    }

    const orderId = generateOrderId();
    const now = new Date();
    const order = {
      userId: req.user.id,
      orderId,
      listingId: type === 'sell' && listingId ? String(listingId) : null,
      mineralId: String(mineralId),
      mineralName: mineralName || '',
      quantity: orderedQty,
      amount: amount != null ? String(amount) : null,
      addressId: String(addressId),
      type: type === 'sell' ? 'sell' : 'buy',
      status: 'Submitted',
      mineralType: mineralType || 'raw',
      buyerCategory: buyerCategory || null,
      deliveryMethod: deliveryMethod || 'Direct Delivery',
      subtotal: subtotal != null ? Number(subtotal) : null,
      transportFee: transportFee != null ? Number(transportFee) : null,
      feePercent: feePercent != null ? Number(feePercent) : null,
      totalDue: totalDue != null ? Number(totalDue) : null,
      unit: unit || 'kg',
      estimatedPayout: estimatedPayout != null ? Number(estimatedPayout) : null,
      originLocation: String(originLocation || origin || '').trim() || null,
      extractionDate: extractionDate ? new Date(extractionDate) : null,
      extractionYear: extractionYear ? String(extractionYear).trim() : null,
      sellPhotos: Array.isArray(sellPhotos)
        ? sellPhotos.filter((u) => typeof u === 'string' && u.trim())
        : Array.isArray(photos)
          ? photos.filter((u) => typeof u === 'string' && u.trim())
          : [],
      confirmedPrice: null,
      escrowStatus: 'pending',
      timeline: [{ step: 1, label: ORDER_STEPS[0], at: now }],
      createdAt: now,
      updatedAt: now,
    };
    const result = await db.collection('orders').insertOne(order);
    const inserted = await db.collection('orders').findOne({ _id: result.insertedId });
    const orderMongoId = inserted._id.toString();

    // Auto-create linked transaction (canonical dashboard + legacy app fields)
    const txDoc = buildTransactionFromOrder(inserted, orderMongoId, { status: 'Pending', createdAt: now });
    await db.collection('transactions').insertOne(txDoc);

    const user = await db.collection('users').findOne({ _id: new ObjectId(inserted.userId) }).catch(() => null);
    const rawPhone = user && user.phone ? String(user.phone).trim() : '';
    const phone = rawPhone.length >= 6
      ? (user && user.countryCode ? `${String(user.countryCode).replace(/\s/g, '')}${rawPhone.replace(/^\+/, '').replace(/\D/g, '')}` : rawPhone)
      : '';
    if (phone) {
      const normalized = phone.replace(/\D/g, '');
      const callDoc = {
        phoneNumber: normalized.length >= 10 ? `+${normalized}` : phone,
        normalizedPhone: normalized,
        orderId: orderMongoId,
        userId: inserted.userId,
        userName: (user && (user.name || user.email)) ? (user.name || user.email) : '',
        contextLabel: inserted.orderId,
        at: now,
        note: `Order created (${inserted.type})`,
        admin: 'System',
        teamMembers: ['System'],
        conversationScenario: '',
        callRecordingUrl: '',
        contactMethod: 'Mobile',
        type: 'call',
        status: 'pending',
      };
      await db.collection('call_history').insertOne(callDoc).catch(() => {});
    }

    res.status(201).json({
      _id: inserted._id.toString(),
      id: inserted._id.toString(),
      orderId: inserted.orderId,
      ...order,
      _id: undefined,
      confirmedPrice: resolveConfirmedPriceForApi(inserted),
    });
  } catch (err) {
    console.error('POST /orders error:', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

/**
 * GET /api/orders
 * Query: ?type=buy|sell, ?all=1 (dashboard: all orders; requires x-dashboard-key)
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const type = req.query.type || null;
    const filter = {};
    if (!(req.isDashboard && (req.query.all === '1' || req.query.all === 'true'))) filter.userId = req.user.id;
    if (type === 'buy' || type === 'sell') filter.type = type;
    const list = await db
      .collection('orders')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    res.json(
      list.map((o) => {
        const item = {
          id: o._id.toString(),
          _id: o._id.toString(),
          orderId: o.orderId,
          userId: o.userId,
          listingId: o.listingId,
          mineralId: o.mineralId,
          mineralName: o.mineralName,
          quantity: o.quantity,
          amount: o.amount,
          addressId: o.addressId,
          type: o.type,
          status: o.status,
          mineralType: o.mineralType,
          buyerCategory: o.buyerCategory,
          deliveryMethod: o.deliveryMethod,
          subtotal: o.subtotal,
          transportFee: o.transportFee,
          feePercent: o.feePercent,
          totalDue: o.totalDue,
          unit: o.unit || 'kg',
          estimatedPayout: o.estimatedPayout || null,
          confirmedPrice: resolveConfirmedPriceForApi(o),
          escrowStatus: o.escrowStatus,
          timeline: o.timeline,
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
          contactVerified: o.contactVerified || false,
          contactVerifiedAt: o.contactVerifiedAt || null,
          originLocation: o.originLocation || o.origin || null,
          extractionDate: o.extractionDate || null,
          extractionYear: o.extractionYear || null,
          sellPhotos: Array.isArray(o.sellPhotos) ? o.sellPhotos : [],
        };
        if (o.flowSteps != null) item.flowSteps = o.flowSteps;
        if (o.flowStepData != null) item.flowStepData = o.flowStepData;
        if (o.orderSummary != null) item.orderSummary = o.orderSummary;
        return item;
      })
    );
  } catch (err) {
    console.error('GET /orders error:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

/**
 * GET /api/orders/:id
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid order id' });
    const db = getDB();
    const order = await db.collection('orders').findOne({
      _id: new ObjectId(id),
      ...(req.isDashboard ? {} : { userId: req.user.id }),
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const out = {
      id: order._id.toString(),
      _id: order._id.toString(),
      orderId: order.orderId,
      userId: order.userId,
      listingId: order.listingId,
      mineralId: order.mineralId,
      mineralName: order.mineralName,
      quantity: order.quantity,
      amount: order.amount,
      addressId: order.addressId,
      type: order.type,
      status: order.status,
      mineralType: order.mineralType,
      buyerCategory: order.buyerCategory,
      deliveryMethod: order.deliveryMethod,
      subtotal: order.subtotal,
      transportFee: order.transportFee,
      feePercent: order.feePercent,
      totalDue: order.totalDue,
      unit: order.unit || 'kg',
      estimatedPayout: order.estimatedPayout || null,
      confirmedPrice: resolveConfirmedPriceForApi(order),
      escrowStatus: order.escrowStatus,
      timeline: order.timeline,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      contactVerified: order.contactVerified || false,
      contactVerifiedAt: order.contactVerifiedAt || null,
      originLocation: order.originLocation || order.origin || null,
      extractionDate: order.extractionDate || null,
      extractionYear: order.extractionYear || null,
      sellPhotos: Array.isArray(order.sellPhotos) ? order.sellPhotos : [],
    };
    if (order.flowSteps != null) out.flowSteps = order.flowSteps;
    if (order.flowStepData != null) out.flowStepData = order.flowStepData;
    if (order.orderSummary != null) out.orderSummary = order.orderSummary;
    res.json(out);
  } catch (err) {
    console.error('GET /orders/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

/**
 * GET /api/orders/:id/contact-summary
 * Returns a user-safe summary of recent contact attempts (calls/emails) for this order.
 */
router.get('/:id/contact-summary', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid order id' });
    const db = getDB();

    // Ensure user owns this order (unless dashboard)
    const order = await db.collection('orders').findOne({
      _id: new ObjectId(id),
      ...(req.isDashboard ? {} : { userId: req.user.id }),
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const orderIdStr = order._id.toString();

    // Fetch recent call history entries for this order (limit 10, newest first)
    const callHistoryDocs = await db
      .collection('call_history')
      .find({ orderId: orderIdStr })
      .sort({ at: -1 })
      .limit(10)
      .toArray()
      .catch(() => []);

    const callHistory = callHistoryDocs.map((c) => ({
      at: c.at,
      contactMethod: c.contactMethod,
      note: c.note || '',
      conversationScenario: c.conversationScenario || '',
      admin: c.admin || '',
      source: 'call_history',
    }));

    // Fetch scheduled calls for this order and flatten contactHistory
    const scheduledDocs = await db
      .collection('scheduled_calls')
      .find({ orderId: orderIdStr })
      .toArray()
      .catch(() => []);

    const scheduled = [];
    scheduledDocs.forEach((sc) => {
      (sc.contactHistory || []).forEach((entry) => {
        scheduled.push({
          at: entry.at,
          contactMethod: entry.contactMethod || 'Mobile',
          note: entry.note || '',
          conversationScenario: entry.conversationScenario || '',
          admin: entry.admin || '',
          source: 'scheduled',
        });
      });
    });

    const merged = [...callHistory, ...scheduled].sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
    );

    res.json({
      orderId: orderIdStr,
      lastContact: merged[0] || null,
      history: merged.slice(0, 20),
    });
  } catch (err) {
    console.error('GET /orders/:id/contact-summary error:', err);
    res.status(500).json({ error: 'Failed to fetch contact summary' });
  }
});

/**
 * PATCH /api/orders/:id
 * Body: { status?, timeline? } — advance 5-step timeline (Submitted → Contact → Sample/Price → Logistics → Complete)
 */
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid order id' });
    const { status, step, estimatedPayout, totalDue, subtotal, transportFee, escrowStatus } = req.body || {};
    const db = getDB();
    const filter = req.isDashboard ? { _id: new ObjectId(id) } : { _id: new ObjectId(id), userId: req.user.id };
    const order = await db.collection('orders').findOne(filter);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const updates = { updatedAt: new Date() };
    if (status !== undefined) updates.status = status;
    if (estimatedPayout != null) updates.estimatedPayout = Number(estimatedPayout);
    if (totalDue != null) updates.totalDue = Number(totalDue);
    if (subtotal != null) updates.subtotal = Number(subtotal);
    if (transportFee != null) updates.transportFee = Number(transportFee);
    if (escrowStatus !== undefined) updates.escrowStatus = escrowStatus;
    if (step != null && step >= 1 && step <= 5) {
      updates.status = ORDER_STEPS[step - 1];
      const timeline = Array.isArray(order.timeline) ? [...order.timeline] : [];
      if (!timeline.some((t) => t.step === step)) {
        timeline.push({ step, label: ORDER_STEPS[step - 1], at: new Date() });
        updates.timeline = timeline;
      }
    }
    await db.collection('orders').updateOne(filter, { $set: updates });
    const updated = await db.collection('orders').findOne({ _id: new ObjectId(id) });
    res.json({
      id: updated._id.toString(),
      orderId: updated.orderId,
      status: updated.status,
      estimatedPayout: updated.estimatedPayout || null,
      totalDue: updated.totalDue || null,
      subtotal: updated.subtotal || null,
      transportFee: updated.transportFee || null,
      escrowStatus: updated.escrowStatus || null,
      timeline: updated.timeline,
    });
  } catch (err) {
    console.error('PATCH /orders/:id error:', err);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

module.exports = router;
