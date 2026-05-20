/**
 * Backfill legacy transaction documents for dashboard settlements.
 * Usage: node scripts/normalize-transactions.js
 * Requires MONGODB_URI (same as server).
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');
const { normalizeTransactionSetFields } = require('../lib/transactions');

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error('Set MONGODB_URI in .env');
  process.exit(1);
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const coll = db.collection('transactions');
  const cursor = coll.find({});
  let scanned = 0;
  let modified = 0;
  while (await cursor.hasNext()) {
    const tx = await cursor.next();
    scanned += 1;
    const set = normalizeTransactionSetFields(tx);
    const keys = Object.keys(set).filter((k) => k !== 'updatedAt');
    if (keys.length === 0) continue;
    await coll.updateOne({ _id: tx._id }, { $set: set });
    modified += 1;
  }
  console.log(`Done. scanned=${scanned} modified=${modified}`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
