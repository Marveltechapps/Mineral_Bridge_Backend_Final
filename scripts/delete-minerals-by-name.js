#!/usr/bin/env node
/**
 * Delete minerals whose name matches (case-insensitive) priya, sangeeth, or wrrer.
 * Run from backend folder: node scripts/delete-minerals-by-name.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { connectDB, getDB } = require('../config/db');

const NAMES_TO_DELETE = ['priya', 'sangeeth', 'wrrer'];

async function main() {
  await connectDB();
  const db = getDB();
  const collection = db.collection('minerals');

  const toDelete = await collection
    .find({
      name: { $in: NAMES_TO_DELETE.map((n) => new RegExp('^' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i')) },
    })
    .toArray();

  if (toDelete.length === 0) {
    console.log('No minerals found with names:', NAMES_TO_DELETE.join(', '));
    return;
  }

  const ids = toDelete.map((m) => m._id);
  const result = await collection.deleteMany({ _id: { $in: ids } });
  console.log('Deleted', result.deletedCount, 'mineral(s):', toDelete.map((m) => m.name).join(', '));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
