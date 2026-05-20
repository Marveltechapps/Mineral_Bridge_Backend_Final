const express = require('express');
const { getDB } = require('../config/db');

const router = express.Router();

/**
 * GET /api/market-insights
 * Returns AI-driven price alerts for Dashboard (e.g. "Lithium +4.2%", "High Demand: Cobalt").
 * Uses market_insights collection; falls back to defaults if empty.
 */
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const list = await db
      .collection('market_insights')
      .find({ enabled: { $ne: false } })
      .sort({ order: 1, createdAt: -1 })
      .limit(10)
      .toArray();
    // Return only real items from DB; no dummy data – app hides section when empty
    const out = list.map((m) => ({
      id: m._id?.toString(),
      label: m.label,
      content: m.content || undefined,
      trend: m.trend,
      type: m.type,
    }));
    res.json(out);
  } catch (err) {
    console.error('GET /market-insights error:', err);
    res.status(500).json({ error: 'Failed to fetch market insights' });
  }
});

module.exports = router;
