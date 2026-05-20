#!/usr/bin/env node
/**
 * One-shot: write availableQuantity + availableQuantityUnit on every mineral from resolved rules.
 * Run: node scripts/normalize-mineral-stock.js
 * Requires MONGODB_URI (or same .env as server).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { connectDB, getDB } = require('../config/db');
const { toOptionalNumber, resolveStockFieldsFromDocument } = require('../lib/mineralStockResolve');

async function main() {
  await connectDB();
  const db = getDB();
  const collection = db.collection('minerals');
  const all = await collection.find({}).toArray();
  let modified = 0;
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
    modified += 1;
    console.log('Updated', m.id || m.name, '->', stock.availableQuantity, stock.availableQuantityUnit);
  }
  console.log('\nDone. Total:', all.length, 'Modified:', modified);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
