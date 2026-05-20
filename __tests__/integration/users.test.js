const request = require('supertest');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const mockUserId = '507f1f77bcf86cd799439011';

jest.mock('../../config/db', () => {
  const { ObjectId } = require('mongodb');
  return {
    connectDB: jest.fn(),
    getDB: jest.fn(() => ({
      collection: jest.fn((name) => {
        const collections = {
          users: {
            findOne: jest.fn(async (query) => {
              if (query._id) {
                const id = query._id.toString();
                if (id === mockUserId) {
                  return {
                    _id: new ObjectId(mockUserId),
                    phone: '+911234567890',
                    name: 'Test User',
                    email: 'test@test.com',
                    countryCode: 'IN',
                  };
                }
              }
              return null;
            }),
            updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
          },
          profiles: {
            findOne: jest.fn(async () => ({
              kycStatus: 'pending',
              avatarKey: 'avatars/test/abc.jpg',
            })),
            updateOne: jest.fn(async () => ({ modifiedCount: 1, upsertedCount: 0 })),
          },
          user_sessions: {
            find: jest.fn(() => ({
              sort: jest.fn(() => ({
                limit: jest.fn(() => ({
                  toArray: jest.fn(async () => [
                    { _id: 'sess1', deviceName: 'iPhone', lastActiveAt: new Date() },
                  ]),
                })),
                toArray: jest.fn(async () => [
                  { _id: 'sess1', deviceName: 'iPhone', lastActiveAt: new Date() },
                ]),
              })),
            })),
            updateOne: jest.fn(async () => ({ upsertedCount: 1 })),
            deleteOne: jest.fn(async () => ({ deletedCount: 1 })),
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
  };
});

jest.mock('../../config/redis', () => ({
  initRedis: jest.fn(),
  getRedis: jest.fn(() => null),
}));

jest.mock('../../config/s3', () => ({
  uploadToS3: jest.fn(async () => ({ key: 'avatars/test/newavatar.jpg', bucket: 'test-user-bucket' })),
  presignedUrl: jest.fn(async (key) => `https://test-bucket.s3.amazonaws.com/${key}?signed=true`),
  deleteFromS3: jest.fn(),
  s3Url: jest.fn((key) => `https://test-bucket.s3.amazonaws.com/${key}`),
  getBucket: jest.fn(() => 'test-user-bucket'),
  BUCKET_USER: 'test-user-bucket',
  BUCKET_ADMIN: 'test-admin-bucket',
  s3: {},
}));

const app = require('../../app');

describe('Users API', () => {
  const token = jwt.sign({ userId: mockUserId }, JWT_SECRET, { expiresIn: '1h' });

  describe('GET /api/users/me', () => {
    it('returns 401 without token', async () => {
      const res = await request(app).get('/api/users/me');
      expect(res.status).toBe(401);
    });

    it('returns current user with valid token', async () => {
      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('phone', '+911234567890');
      expect(res.body).toHaveProperty('name', 'Test User');
    });
  });

  describe('PATCH /api/users/me', () => {
    it('updates user name', async () => {
      const res = await request(app)
        .patch('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated Name' });
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/users/me/security', () => {
    it('returns security settings', async () => {
      const res = await request(app)
        .get('/api/users/me/security')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('twoFactorEnabled');
    });
  });

  describe('GET /api/users/me/sessions', () => {
    it('returns device sessions', async () => {
      const res = await request(app)
        .get('/api/users/me/sessions')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
