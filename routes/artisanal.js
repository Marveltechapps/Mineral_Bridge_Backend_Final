const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { userIdDbMatch } = require('../lib/userIdDbMatch');

const router = express.Router();
const {
  getArtisanalMineralLowerMap,
  normalizeArtisanalMineralType,
  isValidArtisanalMineralType,
} = require('../lib/artisanalMineralValidation');

const ALLOWED_COUNTRIES = ['Ghana', 'Tanzania', 'DRC', 'Zambia', 'Zimbabwe', 'Kenya', 'Uganda', 'Mali', 'Burkina Faso', 'Other'];

/** Dial codes → country name for African eligibility (matches ALLOWED_COUNTRIES) */
const AFRICAN_DIAL_CODES = {
  '+233': 'Ghana', '+234': 'Nigeria', '+255': 'Tanzania', '+243': 'DRC', '+260': 'Zambia',
  '+263': 'Zimbabwe', '+254': 'Kenya', '+256': 'Uganda', '+223': 'Mali', '+226': 'Burkina Faso',
  '+229': 'Benin', '+244': 'Angola', '+258': 'Mozambique', '+221': 'Senegal', '+225': "Côte d'Ivoire",
  '+250': 'Rwanda', '+227': 'Niger', '+228': 'Togo', '+267': 'Botswana', '+264': 'Namibia',
  '+27': 'South Africa', '+237': 'Cameroon', '+251': 'Ethiopia',
};

/**
 * GET /api/artisanal/can-access
 * Auth required. Returns whether the logged-in user can access artisanal/Mining screens.
 * All users can access (country returned for display if African).
 */
router.get('/can-access', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const u = await db.collection('users').findOne({ _id: new ObjectId(req.user.id) });
    if (!u) return res.json({ canAccess: true, country: null });
    const dial = (u.countryCode || (u.phone || '').split('|')[0] || '').trim().replace(/\s/g, '');
    const normalized = dial.startsWith('+') ? dial : dial ? `+${dial}` : '';
    const country = AFRICAN_DIAL_CODES[normalized] || null;
    res.json({ canAccess: true, country: country || null });
  } catch (err) {
    console.error('GET /artisanal/can-access error:', err);
    res.json({ canAccess: true, country: null });
  }
});

/**
 * GET /api/artisanal/eligibility
 * Query: ?country=...
 * Returns whether the region/country is eligible for artisanal program.
 */
router.get('/eligibility', (req, res) => {
  const country = (req.query.country || '').trim();
  const eligible = !country || ALLOWED_COUNTRIES.some((c) => c.toLowerCase() === country.toLowerCase());
  res.json({ eligible, countries: ALLOWED_COUNTRIES });
});

/**
 * GET /api/artisanal/profile
 * Returns full artisanal profile for the current user. Used by both app and dashboard
 * so data is available from anywhere (app → dashboard, dashboard → app).
 */
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const profile = await db.collection('artisanal_profiles').findOne({ userId: req.user.id });
    if (!profile) return res.json(null);
    const { _id, ...rest } = profile;
    res.json({ id: _id.toString(), ...rest });
  } catch (err) {
    console.error('GET /artisanal/profile error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.get('/profile/license', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const profile = await db.collection('artisanal_profiles').findOne({ userId: req.user.id });
    if (!profile || !profile.licenseUrl) return res.status(404).json({ error: 'License not found' });
    const url = profile.licenseUrl;
    if (url.startsWith('data:')) {
      const match = url.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return res.status(500).json({ error: 'Invalid stored file format' });
      const contentType = match[1].trim();
      const buffer = Buffer.from(match[2], 'base64');
      const ext = contentType.includes('pdf') ? '.pdf' : contentType.includes('png') ? '.png' : contentType.includes('jpeg') || contentType.includes('jpg') ? '.jpg' : '';
      res.set('Content-Type', contentType);
      res.set('Content-Disposition', `inline; filename="${profile.licenseName || ('license' + ext)}"`);
      res.set('Cache-Control', 'private, max-age=300');
      return res.send(buffer);
    }
    if (url.startsWith('http://') || url.startsWith('https://')) return res.redirect(url);
    res.status(400).json({ error: 'Unsupported file format' });
  } catch (err) {
    console.error('GET /artisanal/profile/license error:', err);
    res.status(500).json({ error: 'Failed to fetch license' });
  }
});

/**
 * POST /api/artisanal/profile
 * Accepts app flow fields: minerType, country, countryCode, stateProvince, district, village, gps,
 * mineralType, operationQuantity, operationQuantityUnit, miningMethod, yearsExperience, numberOfWorkers, estimatedMonthlyOutput, outputUnit,
 * equipment[], licenseUri, licenseName, childLaborProhibition, ethicalAnswers, laborPledge, status.
 * Validates mineral name, numbers; maps to DB shape. Dashboard/app can GET profile anytime.
 */
router.post('/profile', authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const db = getDB();

    if (body.mineralType && String(body.mineralType).trim()) {
      const mineralMap = await getArtisanalMineralLowerMap(db);
      if (!isValidArtisanalMineralType(body.mineralType, mineralMap)) {
        return res.status(400).json({
          error: 'Enter a mineral from the supported catalog, or a mineral name that exists in the dashboard catalog.',
        });
      }
      body.mineralType = normalizeArtisanalMineralType(body.mineralType, mineralMap);
    }
    const years = body.yearsExperience != null ? Number(body.yearsExperience) : null;
    if (years != null && (Number.isNaN(years) || years < 0)) {
      return res.status(400).json({ error: 'Years of experience must be 0 or more.' });
    }
    const workers = body.numberOfWorkers != null ? Number(body.numberOfWorkers) : body.workers != null ? Number(body.workers) : null;
    if (workers != null && (Number.isNaN(workers) || workers < 0)) {
      return res.status(400).json({ error: 'Number of workers must be 0 or more.' });
    }
    const monthlyOutput = body.estimatedMonthlyOutput != null ? Number(body.estimatedMonthlyOutput) : body.monthlyOutput != null ? Number(body.monthlyOutput) : null;
    if (monthlyOutput != null && (Number.isNaN(monthlyOutput) || monthlyOutput <= 0)) {
      return res.status(400).json({ error: 'Estimated monthly output must be greater than 0.' });
    }

    const opQtyRaw = body.operationQuantity;
    const operationQuantity =
      opQtyRaw != null && opQtyRaw !== '' ? Number(opQtyRaw) : null;
    if (operationQuantity != null && (Number.isNaN(operationQuantity) || operationQuantity <= 0)) {
      return res.status(400).json({ error: 'Operation quantity must be greater than 0.' });
    }
    let operationQuantityUnit = body.operationQuantityUnit != null ? String(body.operationQuantityUnit).trim() : null;
    if (operationQuantityUnit) {
      const u = operationQuantityUnit.toLowerCase();
      const normalized = u === 'mt' ? 'MT' : u;
      const allowedUnits = ['ct', 'g', 'kg', 'MT'];
      if (!allowedUnits.includes(normalized)) {
        return res.status(400).json({ error: 'Operation quantity unit must be ct, g, kg, or MT.' });
      }
      operationQuantityUnit = normalized;
    }

    if (String(body.status || '').toLowerCase() === 'submitted') {
      if (!body.mineralType || !String(body.mineralType).trim()) {
        return res.status(400).json({ error: 'Mineral type is required to submit profile.' });
      }
      if (operationQuantity == null || Number.isNaN(operationQuantity) || operationQuantity <= 0) {
        return res.status(400).json({ error: 'Operation quantity is required to submit profile.' });
      }
      if (!operationQuantityUnit) {
        return res.status(400).json({ error: 'Operation quantity unit is required to submit profile.' });
      }
    }

    const doc = {
      userId: req.user.id,
      minerType: body.minerType || 'individual',
      siteName: body.siteName || '',
      gps: body.gps || null,
      district: body.district || '',
      region: body.stateProvince || body.region || '',
      country: body.country || '',
      countryCode: body.countryCode || null,
      village: body.village || '',
      miningAreaType: body.miningAreaType || null,
      mineralType: body.mineralType ? String(body.mineralType).trim() : null,
      operationQuantity,
      operationQuantityUnit,
      method: body.miningMethod || body.method || null,
      yearsExperience: years,
      workers: workers != null ? Math.floor(workers) : null,
      monthlyOutput,
      outputUnit: body.outputUnit || null,
      equipment: Array.isArray(body.equipment) ? body.equipment : [],
      licenseNumber: body.licenseNumber || '',
      licenseUrl: body.licenseUri || body.licenseUrl || null,
      licenseName: body.licenseName || null,
      childLaborFree: Boolean(body.childLaborProhibition ?? body.childLaborFree),
      safePractices: Boolean(body.safePractices),
      compliance: body.compliance || {},
      ethicalAnswers: body.ethicalAnswers || {},
      laborPledgeSigned: Boolean(body.laborPledge ?? body.laborPledgeSigned),
      completionScore: body.completionScore != null ? Number(body.completionScore) : null,
      minerStatus: body.minerStatus || null,
      blockchainAnchor: body.blockchainAnchor || null,
      eligibilityVerifiedAt: body.eligibilityVerifiedAt ? new Date(body.eligibilityVerifiedAt) : null,
      status: body.status || 'draft',
      updatedAt: new Date(),
    };
    const existing = await db.collection('artisanal_profiles').findOne({ userId: req.user.id });
    if (existing) {
      await db.collection('artisanal_profiles').updateOne({ userId: req.user.id }, { $set: doc });
    } else {
      doc.createdAt = new Date();
      await db.collection('artisanal_profiles').insertOne(doc);
    }
    const updated = await db.collection('artisanal_profiles').findOne({ userId: req.user.id });
    const { _id, ...rest } = updated;
    res.json({ id: _id.toString(), ...rest });
  } catch (err) {
    console.error('POST /artisanal/profile error:', err);
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

/**
 * PATCH /api/artisanal/profile
 * Partial update: accepts any subset of profile fields for app/dashboard sync.
 */
router.patch('/profile', authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const db = getDB();
    const allowed = [
      'minerType', 'siteName', 'gps', 'district', 'region', 'country', 'countryCode',
      'village', 'miningAreaType', 'mineralType', 'operationQuantity', 'operationQuantityUnit',
      'method', 'yearsExperience', 'workers',
      'monthlyOutput', 'outputUnit', 'equipment', 'licenseNumber', 'licenseUrl', 'licenseName',
      'childLaborFree', 'safePractices', 'compliance', 'ethicalAnswers', 'laborPledgeSigned',
      'completionScore', 'minerStatus', 'blockchainAnchor', 'status',
      'sustainabilityBannerImage', 'bannerTopImage', 'liquidateBannerImage', 'bannerBottomImage',
    ];
    const updates = {};
    for (const k of Object.keys(body)) {
      if (allowed.includes(k)) updates[k] = body[k];
    }
    if (Object.keys(updates).length === 0) {
      const existing = await db.collection('artisanal_profiles').findOne({ userId: req.user.id });
      if (!existing) return res.json(null);
      const { _id, ...rest } = existing;
      return res.json({ id: _id.toString(), ...rest });
    }
    updates.updatedAt = new Date();
    if (body.mineralType !== undefined && body.mineralType != null && String(body.mineralType).trim()) {
      const mineralMap = await getArtisanalMineralLowerMap(db);
      if (!isValidArtisanalMineralType(body.mineralType, mineralMap)) {
        return res.status(400).json({
          error: 'Enter a mineral from the supported catalog, or a mineral name that exists in the dashboard catalog.',
        });
      }
      updates.mineralType = normalizeArtisanalMineralType(String(body.mineralType).trim(), mineralMap);
    }
    if (updates.operationQuantity !== undefined) {
      const q = updates.operationQuantity != null && updates.operationQuantity !== ''
        ? Number(updates.operationQuantity)
        : null;
      if (q != null && (Number.isNaN(q) || q <= 0)) {
        return res.status(400).json({ error: 'Operation quantity must be greater than 0.' });
      }
      updates.operationQuantity = q;
    }
    if (updates.operationQuantityUnit !== undefined && updates.operationQuantityUnit) {
      const u = String(updates.operationQuantityUnit).trim().toLowerCase();
      const normalized = u === 'mt' ? 'MT' : u;
      const allowedUnits = ['ct', 'g', 'kg', 'MT'];
      if (!allowedUnits.includes(normalized)) {
        return res.status(400).json({ error: 'Operation quantity unit must be ct, g, kg, or MT.' });
      }
      updates.operationQuantityUnit = normalized;
    }
    await db.collection('artisanal_profiles').updateOne(
      { userId: req.user.id },
      { $set: updates },
      { upsert: false }
    );
    const updated = await db.collection('artisanal_profiles').findOne({ userId: req.user.id });
    if (!updated) return res.json(null);
    const { _id, ...rest } = updated;
    res.json({ id: _id.toString(), ...rest });
  } catch (err) {
    console.error('PATCH /artisanal/profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

/**
 * GET /api/artisanal/dashboard
 * Returns all artisanal data in one call: profile, certifications, equipment-requests, incident-reports, safety-training.
 * For dashboard or app screens that need consolidated data.
 */
router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const [profile, cert, equipmentList, incidentList, safetyDoc] = await Promise.all([
      db.collection('artisanal_profiles').findOne({ userId: req.user.id }),
      db.collection('certifications').findOne({ userId: req.user.id }),
      db.collection('equipment_requests').find({ userId: req.user.id }).sort({ requestedAt: -1 }).limit(20).toArray(),
      db.collection('incident_reports').find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(20).toArray(),
      db.collection('safety_training').findOne({ userId: req.user.id }),
    ]);
    const mapProfile = (p) => {
      if (!p) return null;
      const { _id, ...rest } = p;
      return { id: _id.toString(), ...rest };
    };
    const mapCert = (c) => (c ? { tier: c.tier, blockchainHash: c.blockchainHash, gpsAnchored: c.gpsAnchored, l1Accredited: c.l1Accredited, pdfUrl: c.pdfUrl, updatedAt: c.updatedAt } : null);
    const mapEquipment = (list) => list.map((r) => ({ id: r._id.toString(), itemName: r.itemName, status: r.status, requestedAt: r.requestedAt, tier: r.tier, creditRatio: r.creditRatio }));
    const mapIncidents = (list) => list.map((r) => ({ id: r._id.toString(), category: r.category, categoryDisplay: r.categoryDisplay, description: r.description, photoUrl: r.photoUrl, status: r.status, dispatchedAt: r.dispatchedAt, createdAt: r.createdAt }));
    res.json({
      profile: mapProfile(profile),
      certifications: mapCert(cert),
      equipmentRequests: mapEquipment(equipmentList || []),
      incidentReports: mapIncidents(incidentList || []),
      safetyTraining: safetyDoc ? { modules: safetyDoc.modules || [], updatedAt: safetyDoc.updatedAt } : { modules: [], updatedAt: null },
    });
  } catch (err) {
    console.error('GET /artisanal/dashboard error:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

/**
 * GET /api/artisanal/safety-training
 * Returns user's safety training modules (completed / in_progress / locked).
 */
router.get('/safety-training', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    let doc = await db.collection('safety_training').findOne({ userId: req.user.id });
    if (!doc) {
      const defaultModules = [
        { id: 'l1-safety', name: 'L1 Safety', status: 'completed' },
        { id: 'advanced-tools', name: 'Advanced Tool Handling', status: 'in_progress' },
        { id: 'restoration', name: 'Restoration', status: 'locked' },
      ];
      await db.collection('safety_training').insertOne({
        userId: req.user.id,
        modules: defaultModules,
        updatedAt: new Date(),
      });
      doc = await db.collection('safety_training').findOne({ userId: req.user.id });
    }
    res.json({ modules: doc.modules || [], updatedAt: doc.updatedAt });
  } catch (err) {
    console.error('GET /artisanal/safety-training error:', err);
    res.status(500).json({ error: 'Failed to fetch safety training' });
  }
});

/**
 * PATCH /api/artisanal/safety-training
 * Body: { modules: [{ id, name, status }] } or { moduleId, status }
 */
router.patch('/safety-training', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { modules, moduleId, status } = req.body || {};
    if (modules && Array.isArray(modules)) {
      await db.collection('safety_training').updateOne(
        { userId: req.user.id },
        { $set: { modules, updatedAt: new Date() } },
        { upsert: true }
      );
    } else if (moduleId && status) {
      const doc = await db.collection('safety_training').findOne({ userId: req.user.id });
      const mods = (doc && doc.modules) ? [...doc.modules] : [];
      const idx = mods.findIndex((m) => m.id === moduleId);
      if (idx >= 0) mods[idx].status = status;
      else mods.push({ id: moduleId, name: moduleId, status });
      await db.collection('safety_training').updateOne(
        { userId: req.user.id },
        { $set: { modules: mods, updatedAt: new Date() } },
        { upsert: true }
      );
    }
    const updated = await db.collection('safety_training').findOne({ userId: req.user.id });
    res.json({ modules: updated?.modules || [], updatedAt: updated?.updatedAt });
  } catch (err) {
    console.error('PATCH /artisanal/safety-training error:', err);
    res.status(500).json({ error: 'Failed to update safety training' });
  }
});

/**
 * GET /api/artisanal/equipment-requests
 */
router.get('/equipment-requests', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const list = await db
      .collection('equipment_requests')
      .find({ userId: req.user.id })
      .sort({ requestedAt: -1 })
      .toArray();
    res.json(
      list.map((r) => ({
        id: r._id.toString(),
        itemName: r.itemName,
        status: r.status,
        requestedAt: r.requestedAt,
        tier: r.tier,
        creditRatio: r.creditRatio,
      }))
    );
  } catch (err) {
    console.error('GET /artisanal/equipment-requests error:', err);
    res.status(500).json({ error: 'Failed to fetch equipment requests' });
  }
});

/**
 * POST /api/artisanal/equipment-requests
 * Body: { itemName }
 */
router.post('/equipment-requests', authMiddleware, async (req, res) => {
  try {
    const { itemName } = req.body || {};
    if (!itemName || !String(itemName).trim()) {
      return res.status(400).json({ error: 'itemName is required' });
    }
    const db = getDB();
    const doc = {
      userId: req.user.id,
      itemName: String(itemName).trim(),
      status: 'queued',
      requestedAt: new Date(),
      tier: 'Tier 2',
      creditRatio: 75,
    };
    const result = await db.collection('equipment_requests').insertOne(doc);
    const inserted = await db.collection('equipment_requests').findOne({ _id: result.insertedId });
    const requestId = inserted._id.toString();
    const uid = String(req.user.id);
    try {
      const already = await db.collection('notifications').findOne({
        $and: [userIdDbMatch(uid), { 'data.equipmentRequestId': requestId }],
      });
      if (!already) {
        await db.collection('notifications').insertOne({
          userId: uid,
          title: 'Institutional assets — procurement request',
          body: `Your request for ${inserted.itemName} is queued. View status under Artisanal → Institutional Assets → Available for procurement.`,
          data: {
            linkType: 'institutional_assets',
            equipmentRequestId: requestId,
            itemName: inserted.itemName,
            status: inserted.status,
          },
          createdAt: new Date(),
        });
      }
    } catch (notifyErr) {
      console.error('POST /artisanal/equipment-requests: notification insert failed:', notifyErr);
    }
    res.status(201).json({
      id: requestId,
      itemName: inserted.itemName,
      status: inserted.status,
      requestedAt: inserted.requestedAt,
    });
  } catch (err) {
    console.error('POST /artisanal/equipment-requests error:', err);
    res.status(500).json({ error: 'Failed to create equipment request' });
  }
});

/**
 * PATCH /api/artisanal/equipment-requests/:id
 * Update equipment request: status (queued | processing | completed | cancelled).
 */
router.patch('/equipment-requests/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    const db = getDB();
    const ObjectId = require('mongodb').ObjectId;
    const validStatuses = ['queued', 'processing', 'completed', 'cancelled'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'status must be queued, processing, completed, or cancelled' });
    }
    let oid;
    try {
      oid = new ObjectId(id);
    } catch {
      return res.status(400).json({ error: 'Invalid equipment request id' });
    }
    const result = await db.collection('equipment_requests').updateOne(
      { _id: oid, userId: req.user.id },
      { $set: { status, updatedAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Equipment request not found' });
    }
    const updated = await db.collection('equipment_requests').findOne({ _id: oid });
    res.json({
      id: updated._id.toString(),
      itemName: updated.itemName,
      status: updated.status,
      requestedAt: updated.requestedAt,
    });
  } catch (err) {
    console.error('PATCH /artisanal/equipment-requests/:id error:', err);
    res.status(500).json({ error: 'Failed to update equipment request' });
  }
});

/**
 * GET /api/artisanal/certifications
 */
router.get('/certifications', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const doc = await db.collection('certifications').findOne({ userId: req.user.id });
    if (!doc) {
      const defaultCert = {
        userId: req.user.id,
        tier: 'Institutional Elite Tier',
        blockchainHash: '0x71C' + Buffer.from(req.user.id).toString('hex').slice(0, 37),
        gpsAnchored: true,
        l1Accredited: true,
        pdfUrl: null,
        updatedAt: new Date(),
      };
      await db.collection('certifications').insertOne(defaultCert);
      return res.json(defaultCert);
    }
    res.json({
      tier: doc.tier,
      blockchainHash: doc.blockchainHash,
      gpsAnchored: doc.gpsAnchored,
      l1Accredited: doc.l1Accredited,
      pdfUrl: doc.pdfUrl,
      updatedAt: doc.updatedAt,
    });
  } catch (err) {
    console.error('GET /artisanal/certifications error:', err);
    res.status(500).json({ error: 'Failed to fetch certifications' });
  }
});

/**
 * PATCH /api/artisanal/certifications
 * Partial update: tier, blockchainHash, gpsAnchored, l1Accredited, pdfUrl.
 */
router.patch('/certifications', authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const db = getDB();
    const updates = {};
    if (body.tier != null) updates.tier = String(body.tier);
    if (body.blockchainHash != null) updates.blockchainHash = String(body.blockchainHash);
    if (body.gpsAnchored != null) updates.gpsAnchored = Boolean(body.gpsAnchored);
    if (body.l1Accredited != null) updates.l1Accredited = Boolean(body.l1Accredited);
    if (body.pdfUrl != null) updates.pdfUrl = body.pdfUrl;
    if (Object.keys(updates).length === 0) {
      const doc = await db.collection('certifications').findOne({ userId: req.user.id });
      return res.json(doc || null);
    }
    updates.updatedAt = new Date();
    await db.collection('certifications').updateOne(
      { userId: req.user.id },
      { $set: updates },
      { upsert: true }
    );
    const updated = await db.collection('certifications').findOne({ userId: req.user.id });
    res.json({ tier: updated.tier, blockchainHash: updated.blockchainHash, gpsAnchored: updated.gpsAnchored, l1Accredited: updated.l1Accredited, pdfUrl: updated.pdfUrl, updatedAt: updated.updatedAt });
  } catch (err) {
    console.error('PATCH /artisanal/certifications error:', err);
    res.status(500).json({ error: 'Failed to update certifications' });
  }
});

/**
 * GET /api/artisanal/incident-reports
 */
router.get('/incident-reports', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const list = await db
      .collection('incident_reports')
      .find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    res.json(
      list.map((r) => ({
        id: r._id.toString(),
        category: r.category,
        description: r.description,
        photoUrl: r.photoUrl,
        status: r.status,
        dispatchedAt: r.dispatchedAt,
        createdAt: r.createdAt,
      }))
    );
  } catch (err) {
    console.error('GET /artisanal/incident-reports error:', err);
    res.status(500).json({ error: 'Failed to fetch incident reports' });
  }
});

/** Frontend incident categories (Incident Log) and backend normalized values. */
const INCIDENT_CATEGORY_MAP = {
  'Safety Breach': 'Safety',
  'Medical Emergency': 'Injury',
  'Environmental Spill': 'Environmental',
  'Unauthorized Site Access': 'Safety',
  Safety: 'Safety',
  Injury: 'Injury',
  Environmental: 'Environmental',
};

/**
 * POST /api/artisanal/incident-reports
 * Body: { category, description?, photoUrl? } — category: Safety Breach | Medical Emergency | Environmental Spill | Unauthorized Site Access (or Safety | Injury | Environmental)
 */
router.post('/incident-reports', authMiddleware, async (req, res) => {
  try {
    const { category, description, photoUrl } = req.body || {};
    const categoryTrimmed = typeof category === 'string' ? category.trim() : '';
    const normalizedCategory = INCIDENT_CATEGORY_MAP[categoryTrimmed] || (['Safety', 'Injury', 'Environmental'].includes(categoryTrimmed) ? categoryTrimmed : null);
    const allowed = ['Safety', 'Injury', 'Environmental'];
    if (!categoryTrimmed || !normalizedCategory || !allowed.includes(normalizedCategory)) {
      return res.status(400).json({ error: 'category must be Safety Breach, Medical Emergency, Environmental Spill, or Unauthorized Site Access' });
    }
    const db = getDB();
    const now = new Date();
    const doc = {
      userId: req.user.id,
      category: normalizedCategory,
      categoryDisplay: categoryTrimmed,
      description: description || '',
      photoUrl: photoUrl || null,
      status: 'dispatched',
      dispatchedAt: now,
      createdAt: now,
    };
    const result = await db.collection('incident_reports').insertOne(doc);
    const inserted = await db.collection('incident_reports').findOne({ _id: result.insertedId });
    res.status(201).json({
      id: inserted._id.toString(),
      category: inserted.category,
      description: inserted.description,
      status: inserted.status,
      dispatchedAt: inserted.dispatchedAt,
    });
  } catch (err) {
    console.error('POST /artisanal/incident-reports error:', err);
    res.status(500).json({ error: 'Failed to submit incident report' });
  }
});

/**
 * PATCH /api/artisanal/incident-reports/:id
 * Update incident report: status (dispatched | in_progress | resolved | closed).
 */
router.patch('/incident-reports/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    const db = getDB();
    const ObjectId = require('mongodb').ObjectId;
    const validStatuses = ['dispatched', 'in_progress', 'resolved', 'closed'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'status must be dispatched, in_progress, resolved, or closed' });
    }
    let oid;
    try {
      oid = new ObjectId(id);
    } catch {
      return res.status(400).json({ error: 'Invalid incident report id' });
    }
    const result = await db.collection('incident_reports').updateOne(
      { _id: oid, userId: req.user.id },
      { $set: { status, updatedAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Incident report not found' });
    }
    const updated = await db.collection('incident_reports').findOne({ _id: oid });
    res.json({
      id: updated._id.toString(),
      category: updated.category,
      description: updated.description,
      status: updated.status,
      dispatchedAt: updated.dispatchedAt,
    });
  } catch (err) {
    console.error('PATCH /artisanal/incident-reports/:id error:', err);
    res.status(500).json({ error: 'Failed to update incident report' });
  }
});

module.exports = router;
