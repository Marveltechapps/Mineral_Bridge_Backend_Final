const { MongoClient } = require('mongodb');

let db = null;

async function connectDB() {
  if (db) return db;
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const client = new MongoClient(uri);
  await client.connect();
  db = client.db('mineral_bridge');
  return db;
}

function getDB() {
  if (!db) throw new Error('DB not connected. Call connectDB() first.');
  return db;
}

module.exports = { connectDB, getDB };
