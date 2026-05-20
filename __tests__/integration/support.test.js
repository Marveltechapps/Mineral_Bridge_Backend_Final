const request = require('supertest');

jest.mock('../../config/db', () => ({
  connectDB: jest.fn(),
  getDB: jest.fn(() => ({
    collection: jest.fn((name) => {
      const collections = {
        faqs: {
          find: jest.fn(() => ({
            sort: jest.fn(() => ({
              toArray: jest.fn(async () => [
                { _id: '1', question: 'How to buy?', answer: 'Go to buy tab', category: 'buying' },
                { _id: '2', question: 'How to sell?', answer: 'Go to sell tab', category: 'selling' },
              ]),
            })),
          })),
        },
        support_requests: {
          insertOne: jest.fn(async () => ({ insertedId: 'sr1' })),
        },
        market_insights: {
          find: jest.fn(() => ({
            sort: jest.fn(() => ({
              limit: jest.fn(() => ({
                toArray: jest.fn(async () => [
                  { _id: '1', label: 'Gold prices up 5%', trend: 'up', type: 'alert' },
                ]),
              })),
              toArray: jest.fn(async () => []),
            })),
          })),
        },
      };
      return collections[name] || {
        findOne: jest.fn(async () => null),
        find: jest.fn(() => ({ sort: jest.fn(() => ({ toArray: jest.fn(async () => []) })) })),
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

describe('Help & Support API', () => {
  describe('GET /api/support-config', () => {
    it('returns support configuration', async () => {
      const res = await request(app).get('/api/support-config');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('supportEmail');
    });
  });

  describe('GET /api/market-insights', () => {
    it('returns market insights array', async () => {
      const res = await request(app).get('/api/market-insights');
      expect(res.status).toBe(200);
    });
  });
});
