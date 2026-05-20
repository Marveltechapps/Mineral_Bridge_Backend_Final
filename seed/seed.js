require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const { MongoClient } = require('mongodb');

const MINERALS = [
  { id: 'gold', name: 'Gold', category: 'Precious Metals', imageUrl: 'https://images.unsplash.com/photo-1624365169364-0640dd10e180?w=1080', priceDisplay: '$2,400 / oz' },
  { id: 'silver', name: 'Silver', category: 'Precious Metals', imageUrl: 'https://images.unsplash.com/photo-1760651913970-98e38bd28f77?w=1080', priceDisplay: '$28 / oz' },
  {
    id: 'diamond',
    name: 'Diamonds',
    category: 'Precious Metals',
    imageUrl: 'https://images.unsplash.com/photo-1622573502078-2234273d46b1?w=1080',
    priceDisplay: 'Market Price',
    origin: 'Ghana, Tarkwa',
    purity: '99.9% Certified',
    description: 'This premium batch is ethically sourced from certified artisanal pits under strict institutional supervision. It has undergone rigorous purity verification and is stored in climate-controlled facilities. All sourcing data is anchored to the immutable ledger for 100% geographic traceability.',
  },
  { id: 'emerald', name: 'Emerald', category: 'Gemstones & Rare Jewels', imageUrl: 'https://images.unsplash.com/photo-1600119612651-0db31b3a7baa?w=1080', priceDisplay: null },
  { id: 'ruby', name: 'Ruby', category: 'Gemstones & Rare Jewels', imageUrl: 'https://images.unsplash.com/photo-1726926080812-f29459434ad4?w=1080', priceDisplay: null },
  { id: 'tanzanite', name: 'Tanzanite', category: 'Gemstones & Rare Jewels', imageUrl: 'https://images.unsplash.com/photo-1676721519521-cf9b7a17ae79?w=1080', priceDisplay: null },
  { id: 'opal', name: 'Black & Fire Opal', category: 'Gemstones & Rare Jewels', imageUrl: 'https://images.unsplash.com/photo-1701543262887-c6abee026bd7?w=1080', priceDisplay: null },
  { id: 'copper', name: 'Copper', category: 'Base & Alloy Metals', imageUrl: 'https://images.unsplash.com/photo-1548357204-82fc6c4a0c67?w=1080', priceDisplay: null },
  { id: 'nickel', name: 'Nickel', category: 'Base & Alloy Metals', imageUrl: 'https://images.unsplash.com/photo-1760651691848-e401abe6191b?w=1080', priceDisplay: null },
  { id: 'cobalt', name: 'Cobalt', category: 'Base & Alloy Metals', imageUrl: 'https://images.unsplash.com/photo-1570800384563-47b66b89d5df?w=1080', priceDisplay: null },
  { id: 'limestone', name: 'Limestone', category: 'Industrial Minerals', imageUrl: 'https://images.unsplash.com/photo-1700887937875-988a05e36f4a?w=1080', priceDisplay: null },
  { id: 'quartz', name: 'Quartz', category: 'Industrial Minerals', imageUrl: 'https://images.unsplash.com/photo-1758275872445-d07581768ab6?w=1080', priceDisplay: null },
  { id: 'lithium', name: 'Lithium', category: 'Energy & Strategic', imageUrl: 'https://images.unsplash.com/photo-1571223641822-b82408a0e705?w=1080', priceDisplay: 'Market Price' },
  { id: 'uranium', name: 'Uranium', category: 'Energy & Strategic', imageUrl: 'https://images.unsplash.com/photo-1631049129023-3b03d6d9b8bd?w=1080', priceDisplay: null },
];

async function seed() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('mineral_bridge');
    const col = db.collection('minerals');
    await col.deleteMany({});
    const result = await col.insertMany(MINERALS);
    console.log('Seeded', result.insertedCount, 'minerals into mineral_bridge.minerals');
  } finally {
    await client.close();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
