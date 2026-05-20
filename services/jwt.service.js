const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-please-change';
const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '30d';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '90d';

function generateAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
}

function generateRefreshToken(payload) {
  const tokenId = crypto.randomBytes(16).toString('hex');
  const token = jwt.sign(
    { ...payload, type: 'refresh', jti: tokenId },
    JWT_SECRET,
    { expiresIn: REFRESH_EXPIRES }
  );
  return { token, tokenId };
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { generateAccessToken, generateRefreshToken, verifyToken };
