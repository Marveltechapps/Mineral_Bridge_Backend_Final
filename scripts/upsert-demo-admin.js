/**
 * Ensures admin@mineralbridge.com exists with password demo123 (bcrypt).
 * Use after switching MONGO_URI to a new/empty cluster, or when dashboard login fails.
 *
 *   cd backend && npm run seed-demo-admin
 *
 * Requires: MONGO_URI in .env, network access to Atlas.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
// Same as server.js — fixes querySrv ECONNREFUSED on some Windows/DNS setups for mongodb+srv://
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

const DB_NAME = 'mineral_bridge';
const EMAIL = 'admin@mineralbridge.com';

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('Set MONGO_URI in backend/.env');
    process.exit(1);
  }
  const hash = await bcrypt.hash('demo123', 10);
  const now = new Date();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB_NAME);
  const r = await db.collection('admin_users').updateOne(
    { email: EMAIL },
    {
      $set: {
        name: 'Admin',
        email: EMAIL,
        passwordHash: hash,
        role: 'ceo',
        status: 'Active',
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
  await client.close();
  console.log('OK:', EMAIL, '/ demo123');
  console.log('  upserted:', r.upsertedCount === 1, 'modified:', r.modifiedCount === 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
