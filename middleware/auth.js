const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');
const {
  getUserAccessProfile,
  isAccountRestricted,
  isKycRejected,
  accountRestrictedPayload,
  kycRejectedPayload,
} = require('../lib/accountAccess');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-please-change';
const DASHBOARD_SECRET = process.env.DASHBOARD_SECRET || '';

function dashboardKey(req) {
  req.isDashboard = !!(DASHBOARD_SECRET && req.headers['x-dashboard-key'] === DASHBOARD_SECRET);
}

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token && req.query && (req.query.token || req.query.access_token)) {
    token = req.query.token || req.query.access_token;
  }
  dashboardKey(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = getDB();

    if (decoded.type === 'admin' && decoded.adminId) {
      const admin = await db.collection('admin_users').findOne({ _id: new ObjectId(decoded.adminId) });
      if (!admin || admin.status !== 'Active') {
        return res.status(401).json({ error: 'Admin not found or inactive' });
      }
      req.user = { _id: admin._id, id: String(admin._id), name: admin.name, email: admin.email, role: admin.role };
      req.isAdmin = true;
      return next();
    }

    const user = await db.collection('users').findOne({ _id: new ObjectId(decoded.userId) });
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    const access = await getUserAccessProfile(db, user._id);
    const path = req.path || '';
    const original = req.originalUrl || '';
    const allowAccessProfileMe =
      req.method === 'GET' &&
      (path === '/me' || path.startsWith('/me/') || /\/users\/me(\/|$|\?)/.test(original));
    if (isAccountRestricted(access) && !allowAccessProfileMe) {
      return res.status(403).json(accountRestrictedPayload(access));
    }
    if (isKycRejected(access) && !allowAccessProfileMe) {
      return res.status(403).json(kycRejectedPayload(access));
    }
    req.user = {
      _id: user._id,
      id: String(user._id),
      phone: user.phone,
      countryCode: user.countryCode,
      name: user.name,
      email: user.email,
      accountStatus: access.accountStatus,
      kycStatus: access.kycStatus,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { authMiddleware, dashboardKey };
