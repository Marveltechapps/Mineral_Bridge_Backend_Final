const request = require('supertest');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const mockUserId = '507f1f77bcf86cd799439011';
const mockUser = {
  _id: { toString: () => mockUserId },
  phone: '+911234567890',
  countryCode: 'IN',
  name: 'Test User',
  email: 'test@test.com',
  isVerified: true,
};

jest.mock('../../config/db', () => {
  const { ObjectId } = require('mongodb');
  return {
    connectDB: jest.fn(),
    getDB: jest.fn(() => ({
      collection: jest.fn((name) => {
        const collections = {
          users: {
            findOne: jest.fn(async (query) => {
              if (query.phone === '+911234567890') return { ...mockUser, _id: new ObjectId(mockUserId) };
              if (query._id) {
                const id = query._id.toString();
                if (id === mockUserId) return { ...mockUser, _id: new ObjectId(mockUserId) };
              }
              return null;
            }),
            insertOne: jest.fn(async (doc) => ({ insertedId: new ObjectId(mockUserId) })),
            updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
          },
          profiles: {
            findOne: jest.fn(async () => ({ kycStatus: 'pending', avatarKey: null })),
            updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
          },
          user_sessions: {
            find: jest.fn(() => ({
              sort: jest.fn(() => ({
                limit: jest.fn(() => ({
                  toArray: jest.fn(async () => []),
                })),
                toArray: jest.fn(async () => []),
              })),
            })),
            updateOne: jest.fn(async () => ({ upsertedCount: 0 })),
          },
          otps: {
            findOne: jest.fn(async () => null),
            insertOne: jest.fn(),
            deleteMany: jest.fn(),
            updateOne: jest.fn(),
          },
          otp_rate_limits: {
            findOne: jest.fn(async () => null),
            updateOne: jest.fn(),
          },
          otp_brute_force: {
            findOne: jest.fn(async () => null),
            updateOne: jest.fn(),
          },
          refresh_tokens: {
            insertOne: jest.fn(),
            findOne: jest.fn(async () => null),
            deleteOne: jest.fn(),
          },
          login_history: {
            insertOne: jest.fn(),
            findOne: jest.fn(async () => ({ userId: mockUserId, ip: '127.0.0.1', loggedInAt: new Date() })),
            find: jest.fn(() => ({
              sort: jest.fn(() => ({
                limit: jest.fn(() => ({
                  toArray: jest.fn(async () => []),
                })),
              })),
            })),
          },
          security_alerts: {
            insertOne: jest.fn(),
            find: jest.fn(() => ({
              sort: jest.fn(() => ({
                toArray: jest.fn(async () => []),
              })),
            })),
          },
        };
        return collections[name] || {
          findOne: jest.fn(async () => null),
          find: jest.fn(() => ({ sort: jest.fn(() => ({ limit: jest.fn(() => ({ toArray: jest.fn(async () => []) })) })) })),
          insertOne: jest.fn(),
          updateOne: jest.fn(),
          deleteMany: jest.fn(),
        };
      }),
    })),
  };
});

jest.mock('../../config/redis', () => ({
  initRedis: jest.fn(),
  getRedis: jest.fn(() => null),
}));

const app = require('../../app');

describe('Auth API', () => {
  describe('POST /api/auth/send-otp', () => {
    it('returns 400 without phone number', async () => {
      const res = await request(app)
        .post('/api/auth/send-otp')
        .send({});
      expect(res.status).toBe(400);
    });

    it('accepts a valid phone number', async () => {
      const res = await request(app)
        .post('/api/auth/send-otp')
        .send({ phone: '+911234567890', countryCode: 'IN' });
      expect([200, 201, 429]).toContain(res.status);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns 401 without auth token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('returns user info with valid token', async () => {
      const token = jwt.sign({ userId: mockUserId }, JWT_SECRET, { expiresIn: '1h' });
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('phone');
    });
  });

  describe('GET /api/auth/sessions', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/auth/sessions');
      expect(res.status).toBe(401);
    });

    it('returns session list with valid token', async () => {
      const token = jwt.sign({ userId: mockUserId }, JWT_SECRET, { expiresIn: '1h' });
      const res = await request(app)
        .get('/api/auth/sessions')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
