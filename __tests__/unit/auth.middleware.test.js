const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

describe('Auth Middleware', () => {
  let authMiddleware, dashboardKey;
  let req, res, next;

  beforeEach(() => {
    jest.resetModules();

    jest.mock('../../config/db', () => ({
      getDB: jest.fn(() => ({
        collection: jest.fn(() => ({
          findOne: jest.fn(async (query) => {
            const id = query._id.toString();
            if (id === '507f1f77bcf86cd799439011') {
              return { _id: query._id, phone: '+911234567890', name: 'Test User', email: 'test@test.com' };
            }
            return null;
          }),
        })),
      })),
    }));

    const auth = require('../../middleware/auth');
    authMiddleware = auth.authMiddleware;
    dashboardKey = auth.dashboardKey;

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns 401 when no token is provided', async () => {
    req = { headers: {}, query: {} };
    await authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('authenticates with a valid Bearer token', async () => {
    const token = jwt.sign({ userId: '507f1f77bcf86cd799439011' }, JWT_SECRET, { expiresIn: '1h' });
    req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    await authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.phone).toBe('+911234567890');
  });

  it('authenticates with token in query params', async () => {
    const token = jwt.sign({ userId: '507f1f77bcf86cd799439011' }, JWT_SECRET, { expiresIn: '1h' });
    req = { headers: {}, query: { token } };
    await authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
  });

  it('returns 401 for an expired token', async () => {
    const token = jwt.sign({ userId: '507f1f77bcf86cd799439011' }, JWT_SECRET, { expiresIn: '-10s' });
    req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    await authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
  });

  it('returns 401 for an invalid token', async () => {
    req = { headers: { authorization: 'Bearer totally-invalid-token' }, query: {} };
    await authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when user is not found in DB', async () => {
    const token = jwt.sign({ userId: '507f1f77bcf86cd799439099' }, JWT_SECRET, { expiresIn: '1h' });
    req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    await authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'User not found' });
  });

  describe('dashboardKey', () => {
    it('sets isDashboard=true when header matches secret', () => {
      req = { headers: { 'x-dashboard-key': 'test-dashboard-secret' } };
      dashboardKey(req);
      expect(req.isDashboard).toBe(true);
    });

    it('sets isDashboard=false when header does not match', () => {
      req = { headers: { 'x-dashboard-key': 'wrong-secret' } };
      dashboardKey(req);
      expect(req.isDashboard).toBe(false);
    });

    it('sets isDashboard=false when header is missing', () => {
      req = { headers: {} };
      dashboardKey(req);
      expect(req.isDashboard).toBe(false);
    });
  });
});
