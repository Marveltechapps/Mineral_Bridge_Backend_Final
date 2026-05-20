/**
 * One-time copy of all collections from SOURCE cluster → TARGET cluster,
 * both using database name "mineral_bridge" (same as config/db.js).
 *
 * Usage (PowerShell):
 *   $env:SOURCE_MONGO_URI="mongodb+srv://user:pass@OLD_CLUSTER.mongodb.net/?retryWrites=true&w=majority"
 *   $env:TARGET_MONGO_URI=$env:MONGO_URI   # or paste new cluster URI
 *   npm run migrate-db
 *
 * Or temporarily set SOURCE_MONGO_URI in .env, keep MONGO_URI as the NEW cluster, then:
 *   npm run migrate-db
 *
 * Requires: both Atlas clusters allow your current IP (Network Access).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const { MongoClient } = require('mongodb');

const DB_NAME = 'mineral_bridge';
const BATCH = 500;

async function main() {
  const sourceUri = process.env.SOURCE_MONGO_URI;
  const targetUri = process.env.TARGET_MONGO_URI || process.env.MONGO_URI || process.env.MONGODB_URI;

  if (!sourceUri || !targetUri) {
    console.error('Missing SOURCE_MONGO_URI or TARGET/MONGO_URI.');
    console.error('Set SOURCE_MONGO_URI to the OLD cluster and MONGO_URI (or TARGET_MONGO_URI) to the NEW cluster.');
    process.exit(1);
  }
  if (sourceUri === targetUri) {
    console.error('SOURCE and TARGET URIs must be different.');
    process.exit(1);
  }

  const srcClient = new MongoClient(sourceUri);
  const tgtClient = new MongoClient(targetUri);

  await srcClient.connect();
  await tgtClient.connect();
  const src = srcClient.db(DB_NAME);
  const tgt = tgtClient.db(DB_NAME);

  const cols = await src.listCollections().toArray();
  const names = cols.map((c) => c.name).filter((n) => !n.startsWith('system.'));

  console.log(`Copying ${names.length} collections from "${DB_NAME}" …`);

  for (const name of names) {
    const cursor = src.collection(name).find({});
    const docs = await cursor.toArray();
    await tgt.collection(name).deleteMany({});
    if (docs.length === 0) {
      console.log(`  ${name}: (empty)`);
      continue;
    }
    for (let i = 0; i < docs.length; i += BATCH) {
      const chunk = docs.slice(i, i + BATCH);
      await tgt.collection(name).insertMany(chunk, { ordered: false });
    }
    console.log(`  ${name}: ${docs.length} documents`);
  }

  await srcClient.close();
  await tgtClient.close();
  console.log('Done. Restart the API with MONGO_URI pointing at the NEW cluster.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
