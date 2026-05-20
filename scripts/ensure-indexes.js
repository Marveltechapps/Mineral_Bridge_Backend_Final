/**
 * Ensures MongoDB indexes for Mineral Bridge collections.
 * Run: node scripts/ensure-indexes.js (from backend dir, after MONGO_URI is set)
 */
require('dotenv').config();
const { connectDB, getDB } = require('../config/db');

async function ensureIndexes() {
  await connectDB();
  const db = getDB();

    // kyc_documents: allow multiple doc types per user (drop old userId-only unique if present)
  try {
    await db.collection('kyc_documents').dropIndex('userId_1');
    console.log('Dropped old kyc_documents userId_1 index');
  } catch (e) {
    if (e.code !== 27) console.log('kyc_documents userId_1 index not found or already dropped');
  }

  const indexes = [
    { collection: 'users', keys: { phone: 1 }, options: { unique: true } },
    { collection: 'otps', keys: { key: 1 }, options: {} },
    { collection: 'otps', keys: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
    { collection: 'profiles', keys: { userId: 1 }, options: { unique: true } },
    { collection: 'kyc_documents', keys: { userId: 1, idType: 1 }, options: { unique: true } },
    { collection: 'addresses', keys: { userId: 1, createdAt: -1 }, options: {} },
    { collection: 'orders', keys: { userId: 1, createdAt: -1 }, options: {} },
    { collection: 'orders', keys: { orderId: 1 }, options: { unique: true, sparse: true } },
    { collection: 'orders', keys: { type: 1, createdAt: -1 }, options: {} },
    { collection: 'listings', keys: { userId: 1, createdAt: -1 }, options: {} },
    { collection: 'listings', keys: { createdAt: -1 }, options: {} },
    { collection: 'listings', keys: { mineralId: 1 }, options: { sparse: true } },
    { collection: 'listings', keys: { status: 1, createdAt: -1 }, options: {} },
    { collection: 'notifications', keys: { userId: 1, createdAt: -1 }, options: {} },
    { collection: 'artisanal_profiles', keys: { userId: 1 }, options: { unique: true } },
    { collection: 'safety_training', keys: { userId: 1 }, options: { unique: true } },
    { collection: 'equipment_requests', keys: { userId: 1, requestedAt: -1 }, options: {} },
    { collection: 'certifications', keys: { userId: 1 }, options: { unique: true } },
    { collection: 'incident_reports', keys: { userId: 1, createdAt: -1 }, options: {} },
    { collection: 'payment_methods', keys: { userId: 1, createdAt: -1 }, options: {} },
    { collection: 'transactions', keys: { userId: 1, date: -1 }, options: {} },
    { collection: 'transactions', keys: { orderId: 1 }, options: {} },
    { collection: 'app_settings', keys: { userId: 1 }, options: { unique: true } },
    { collection: 'minerals', keys: { id: 1 }, options: { unique: true, sparse: true } },
    { collection: 'minerals', keys: { name: 1 }, options: {} },
    { collection: 'minerals', keys: { category: 1 }, options: {} },
    { collection: 'minerals', keys: { availableForBuy: 1, category: 1, sortOrder: 1 }, options: {} },
    { collection: 'minerals', keys: { availableForSell: 1, category: 1, sortOrder: 1 }, options: {} },
    { collection: 'minerals', keys: { verificationStatus: 1 }, options: {} },
    { collection: 'content', keys: { key: 1 }, options: { unique: true } },
    { collection: 'account_deletions', keys: { userId: 1, status: 1 }, options: {} },
    { collection: 'account_deletions', keys: { status: 1, createdAt: -1 }, options: {} },
    { collection: 'account_deletions', keys: { createdAt: -1 }, options: {} },
    { collection: 'call_history', keys: { at: -1 }, options: {} },
    { collection: 'call_history', keys: { normalizedPhone: 1, at: -1 }, options: {} },
    { collection: 'call_history', keys: { orderId: 1, at: -1 }, options: { sparse: true } },
    { collection: 'audit_log', keys: { createdAt: -1 }, options: {} },
    { collection: 'audit_log', keys: { type: 1, createdAt: -1 }, options: {} },
    { collection: 'platform_settings', keys: { updatedAt: -1 }, options: {} },
    { collection: 'admin_users', keys: { email: 1 }, options: { unique: true } },
    { collection: 'admin_roles', keys: { name: 1 }, options: { unique: true, sparse: true } },
    { collection: 'dashboard_help_faqs', keys: { order: 1 }, options: {} },
    { collection: 'dashboard_help_quick_links', keys: { order: 1 }, options: {} },
  ];

  for (const { collection, keys, options } of indexes) {
    try {
      await db.collection(collection).createIndex(keys, options);
      console.log(`Created index on ${collection}:`, JSON.stringify(keys));
    } catch (err) {
      if (err.code === 85 || err.codeName === 'IndexOptionsConflict' || err.code === 86) {
        console.log(`Index exists or conflict on ${collection}, skipping.`);
      } else {
        console.error(`Error creating index on ${collection}:`, err.message);
      }
    }
  }

  console.log('Index ensure complete.');
  process.exit(0);
}

ensureIndexes().catch((err) => {
  console.error(err);
  process.exit(1);
});
