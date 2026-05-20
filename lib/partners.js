/**
 * Partner & Vendor Management — profiles, regions, third-party logistics.
 */

const DEFAULT_REGIONS = [
  { value: 'all', label: 'All Regions', order: 0 },
  { value: 'asia', label: 'Asia', order: 1 },
  { value: 'africa', label: 'Africa', order: 2 },
  { value: 'eu', label: 'Europe', order: 3 },
  { value: 'americas', label: 'Americas', order: 4 },
];

const DEFAULT_PROFILES = [
  {
    name: 'SGS',
    displayName: 'SGS Minerals Services',
    logoUrl: 'https://images.unsplash.com/photo-1579389083046-e3df9c2b3325?w=200&h=200&fit=crop',
    regions: ['asia', 'africa', 'eu'],
  },
  {
    name: 'Other',
    displayName: 'Other Partner',
    logoUrl: 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=200&h=200&fit=crop',
    regions: ['all'],
  },
];

function mapShipmentStatusToPartner(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'delivered') return 'Delivered';
  if (s === 'in-transit' || s === 'in_transit') return 'In transit';
  if (s === 'testing' || s === 'at-lab') return 'Sample received at lab';
  return 'Pending';
}

function mapPartnerStatusToShipment(status) {
  const s = String(status || '');
  if (s === 'Delivered') return 'delivered';
  if (s === 'In transit') return 'in-transit';
  if (s === 'Sample received at lab') return 'testing';
  return 'pending';
}

function shipmentToThirdPartyEntry(doc) {
  const id = doc.id || String(doc._id || '');
  return {
    id,
    orderId: String(doc.orderId || ''),
    companyName: doc.carrierName || doc.carrier || '',
    trackingNumber: String(doc.trackingNumber || ''),
    trackingUrl: String(doc.trackingUrl || ''),
    submittedAt: doc.createdAt
      ? new Date(doc.createdAt).toISOString().slice(0, 10)
      : undefined,
    contactPhone: doc.contactPhone || '',
    contactEmail: doc.contactEmail || '',
    companyDetails: doc.notes || doc.companyDetails || '',
    uploadedDocuments: Array.isArray(doc.uploadedDocuments) ? doc.uploadedDocuments : [],
    status: mapShipmentStatusToPartner(doc.status),
    expectedDeliveryDate: doc.estimatedDelivery
      ? new Date(doc.estimatedDelivery).toISOString().slice(0, 10)
      : doc.expectedDeliveryDate || '',
    deliveredAt: doc.actualDelivery
      ? new Date(doc.actualDelivery).toISOString().slice(0, 10)
      : doc.deliveredAt || '',
    testingPartner: doc.testingPartner || 'SGS',
    shippingAmount: doc.shippingAmount != null ? String(doc.shippingAmount) : '',
    shippingCurrency: doc.shippingCurrency || 'USD',
    shipmentId: id,
  };
}

async function buildPartnerProfiles(db) {
  const labs = await db.collection('testing_labs').find({}).sort({ name: 1 }).toArray();
  const byName = new Map();
  for (const p of DEFAULT_PROFILES) {
    byName.set(p.name.toLowerCase(), { ...p });
  }
  for (const lab of labs) {
    const key = String(lab.name || '').toLowerCase();
    if (!key) continue;
    if (!byName.has(key)) {
      byName.set(key, {
        name: lab.name,
        displayName: lab.name,
        logoUrl: lab.logoUrl || '',
        regions: lab.regions || [],
      });
    }
  }
  const stored = await db.collection('partner_profiles').find({}).toArray();
  for (const p of stored) {
    const key = String(p.name || '').toLowerCase();
    if (key) byName.set(key, { name: p.name, displayName: p.displayName || p.name, logoUrl: p.logoUrl || '', regions: p.regions || [] });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function buildPartnerRegions(db) {
  const stored = await db.collection('partner_regions').find({}).sort({ order: 1, label: 1 }).toArray();
  if (stored.length > 0) {
    return stored.map((r) => ({ value: r.value, label: r.label }));
  }
  return DEFAULT_REGIONS.map(({ value, label }) => ({ value, label }));
}

async function listThirdPartyLogistics(db, limit = 200) {
  const list = await db.collection('shipments').find({}).sort({ updatedAt: -1, createdAt: -1 }).limit(limit).toArray();
  return list.map((s) => shipmentToThirdPartyEntry({ id: s._id.toString(), ...s, _id: undefined }));
}

async function upsertThirdPartyLogistics(db, body) {
  const orderId = String(body.orderId || '').trim();
  if (!orderId) throw new Error('orderId required');

  const now = new Date();
  const status = mapPartnerStatusToShipment(body.status);
  const doc = {
    orderId,
    carrier: body.companyName || body.carrierName || '',
    carrierName: body.companyName || body.carrierName || '',
    trackingNumber: String(body.trackingNumber || '').trim(),
    trackingUrl: String(body.trackingUrl || '').trim(),
    contactPhone: body.contactPhone || '',
    contactEmail: body.contactEmail || '',
    notes: body.companyDetails || body.notes || '',
    companyDetails: body.companyDetails || '',
    uploadedDocuments: Array.isArray(body.uploadedDocuments) ? body.uploadedDocuments : [],
    status,
    estimatedDelivery: body.expectedDeliveryDate ? new Date(body.expectedDeliveryDate) : null,
    expectedDeliveryDate: body.expectedDeliveryDate || '',
    actualDelivery: body.deliveredAt ? new Date(body.deliveredAt) : null,
    deliveredAt: body.deliveredAt || '',
    testingPartner: body.testingPartner || 'SGS',
    shippingAmount: body.shippingAmount || '',
    shippingCurrency: body.shippingCurrency || 'USD',
    updatedAt: now,
  };

  const existing = await db.collection('shipments').findOne({ orderId });
  if (existing) {
    await db.collection('shipments').updateOne(
      { _id: existing._id },
      {
        $set: doc,
        $push: { timeline: { status: status || 'updated', at: now, note: 'Third-party details updated' } },
      },
    );
    const updated = await db.collection('shipments').findOne({ _id: existing._id });
    return shipmentToThirdPartyEntry({ id: updated._id.toString(), ...updated, _id: undefined });
  }

  const insertDoc = {
    ...doc,
    origin: '',
    destination: '',
    mineral: '',
    weight: '',
    value: 0,
    progress: 0,
    timeline: [{ status: 'created', at: now, note: 'Third-party logistics created' }],
    createdAt: now,
  };
  const result = await db.collection('shipments').insertOne(insertDoc);
  const created = await db.collection('shipments').findOne({ _id: result.insertedId });
  return shipmentToThirdPartyEntry({ id: created._id.toString(), ...created, _id: undefined });
}

async function ensurePartnerSeedData(db) {
  const regionCount = await db.collection('partner_regions').countDocuments({});
  if (regionCount === 0) {
    await db.collection('partner_regions').insertMany(
      DEFAULT_REGIONS.map((r) => ({ ...r, createdAt: new Date() })),
    );
  }
}

module.exports = {
  DEFAULT_REGIONS,
  buildPartnerProfiles,
  buildPartnerRegions,
  listThirdPartyLogistics,
  upsertThirdPartyLogistics,
  ensurePartnerSeedData,
  shipmentToThirdPartyEntry,
};
