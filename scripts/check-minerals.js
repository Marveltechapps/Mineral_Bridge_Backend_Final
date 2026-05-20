#!/usr/bin/env node
/**
 * Quick check: list all minerals in the DB.
 * Run: node scripts/check-minerals.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { connectDB, getDB } = require('../config/db');

async function main() {
  await connectDB();
  const db = getDB();
  const list = await db.collection('minerals').find({}).sort({ name: 1 }).toArray();
  console.log('Minerals in DB:', list.length);
  list.forEach((m) => console.log('  -', m.name, '| category:', m.category || '(empty)', '| id:', m.id || m._id));
}

main().catch((err) => { console.error(err); process.exit(1); });
