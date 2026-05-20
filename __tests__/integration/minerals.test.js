const request = require('supertest');

const mockMinerals = [
  { _id: '1', name: 'Gold', category: 'Precious', price: 1950, unit: 'oz' },
  { _id: '2', name: 'Copper', category: 'Base', price: 4.2, unit: 'lb' },
  { _id: '3', name: 'Lithium', category: 'Rare', price: 45, unit: 'kg' },
];

jest.mock('../../config/db', () => ({
  connectDB: jest.fn(),
  getDB: jest.fn(() => ({
    collection: jest.fn((name) => {
      if (name === 'minerals') {
        return {
          aggregate: jest.fn((pipeline) => {
            // Route uses `collection.aggregate(pipeline).toArray()`.
            // In tests we only need category filtering behavior.
            let data = mockMinerals;
            try {
              const matchStage = Array.isArray(pipeline)
                ? pipeline.find((s) => s && s.$match)
                : null;
              const match = matchStage?.$match || {};

              // Expected shape: { $and: [ ..., { category: /.../i } ] }
              const andParts = Array.isArray(match.$and) ? match.$and : null;
              const categoryCond = andParts
                ? andParts.find((p) => p && p.category)
                : null;

              const cat = categoryCond?.category;
              if (cat instanceof RegExp) {
                data = data.filter((m) => cat.test(m.category));
              } else if (typeof cat === 'string') {
                data = data.filter((m) => m.category === cat);
              }
            } catch {
              // Keep default mockMinerals
            }

            return {
              toArray: jest.fn(async () => data),
            };
          }),
          find: jest.fn((query) => {
            let data = mockMinerals;
            if (query && query.category) {
              data = data.filter(m => m.category === query.category);
            }
            return {
              sort: jest.fn(() => ({
                toArray: jest.fn(async () => data),
              })),
            };
          }),
          findOne: jest.fn(async (query) => {
            if (query.name) return mockMinerals.find(m => m.name === query.name) || null;
            return mockMinerals[0];
          }),
          insertOne: jest.fn(async (doc) => ({ insertedId: 'new-id', ...doc })),
          updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
        };
      }
      return {
        find: jest.fn(() => ({ sort: jest.fn(() => ({ limit: jest.fn(() => ({ toArray: jest.fn(async () => []) })) })) })),
        findOne: jest.fn(async () => null),
        insertOne: jest.fn(),
        updateOne: jest.fn(),
      };
    }),
  })),
}));

jest.mock('../../config/redis', () => ({
  initRedis: jest.fn(),
  getRedis: jest.fn(() => null),
}));

const app = require('../../app');

describe('Minerals API', () => {
  describe('GET /api/minerals', () => {
    it('returns 200 and a list of minerals', async () => {
      const res = await request(app).get('/api/minerals');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(3);
    });

    it('filters minerals by category', async () => {
      const res = await request(app).get('/api/minerals?category=Precious');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.every(m => m.category === 'Precious')).toBe(true);
    });
  });

  describe('GET /api/minerals/:id', () => {
    it('returns a single mineral', async () => {
      const res = await request(app).get('/api/minerals/Gold');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Gold');
    });
  });
});
