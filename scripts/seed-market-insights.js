/**
 * Optional seed: market_insights collection for dashboard AI badges (e.g. "Lithium +4.2%").
 * Run: node scripts/seed-market-insights.js
 */
require('dotenv').config();
const { connectDB, getDB } = require('../config/db');

async function seed() {
  await connectDB();
  const db = getDB();

  const insights = [
    { slug: 'lithium', label: 'Lithium +4.2%', value: '+4.2%', updatedAt: new Date() },
    { slug: 'cobalt', label: 'High Demand: Cobalt', value: 'High Demand', updatedAt: new Date() },
    { slug: 'gold', label: 'Gold exceeded $2,400/oz', value: '$2,400/oz', updatedAt: new Date() },
  ];

  for (const doc of insights) {
    await db.collection('market_insights').updateOne(
      { slug: doc.slug },
      { $set: doc },
      { upsert: true }
    );
  }

  console.log('Market insights seed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
