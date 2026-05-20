const request = require('supertest');

jest.mock('../../config/db', () => ({
  connectDB: jest.fn(),
  getDB: jest.fn(() => ({
    collection: jest.fn(() => ({
      findOne: jest.fn(),
      find: jest.fn(() => ({ sort: jest.fn(() => ({ limit: jest.fn(() => ({ toArray: jest.fn(async () => []) })) })) })),
      insertOne: jest.fn(),
      updateOne: jest.fn(),
    })),
  })),
}));

jest.mock('../../config/redis', () => ({
  initRedis: jest.fn(),
  getRedis: jest.fn(() => null),
}));

const app = require('../../app');

describe('Health Check Endpoint', () => {
  it('GET /health returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'mineral-bridge-api' });
  });

  it('returns JSON content type', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['content-type']).toMatch(/json/);
  });
});
