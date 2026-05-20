const { getRedis } = require('../config/redis');
const { getDB } = require('../config/db');
const { hashOTP, compareOTP } = require('../utils/hash');

const OTP_TTL = parseInt(process.env.OTP_TTL_SECONDS, 10) || 300;
const RATE_LIMIT_MAX = parseInt(process.env.OTP_RATE_LIMIT_MAX, 10) || 3;
const RATE_LIMIT_WINDOW = parseInt(process.env.OTP_RATE_LIMIT_WINDOW_SECONDS, 10) || 600;
const BRUTE_FORCE_MAX = parseInt(process.env.OTP_BRUTE_FORCE_MAX, 10) || 5;
const BRUTE_FORCE_LOCK = parseInt(process.env.OTP_BRUTE_FORCE_LOCK_SECONDS, 10) || 600;

/* ───────── Redis-based implementations ───────── */

async function redisStoreOTP(key, otp) {
  const r = getRedis();
  if (!r) return false;
  const hashed = hashOTP(otp);
  await r.set(`otp:${key}`, hashed, 'EX', OTP_TTL);
  return true;
}

async function redisVerifyOTP(key, otp) {
  const r = getRedis();
  if (!r) return null;
  const stored = await r.get(`otp:${key}`);
  if (!stored) return { found: false };
  const match = compareOTP(otp, stored);
  if (match) await r.del(`otp:${key}`);
  return { found: true, match };
}

async function redisCheckRateLimit(key) {
  const r = getRedis();
  if (!r) return null;
  const rlKey = `otp_rl:${key}`;
  const count = await r.incr(rlKey);
  if (count === 1) await r.expire(rlKey, RATE_LIMIT_WINDOW);
  const ttl = await r.ttl(rlKey);
  return { count, limit: RATE_LIMIT_MAX, blocked: count > RATE_LIMIT_MAX, retryAfter: ttl };
}

async function redisCheckBruteForce(key) {
  const r = getRedis();
  if (!r) return null;
  const bfKey = `otp_fail:${key}`;
  const raw = await r.get(bfKey);
  const fails = parseInt(raw, 10) || 0;
  if (fails >= BRUTE_FORCE_MAX) {
    const ttl = await r.ttl(bfKey);
    return { locked: true, retryAfter: ttl, attempts: fails };
  }
  return { locked: false, attempts: fails };
}

async function redisRecordFailedAttempt(key) {
  const r = getRedis();
  if (!r) return null;
  const bfKey = `otp_fail:${key}`;
  const count = await r.incr(bfKey);
  if (count === 1) await r.expire(bfKey, BRUTE_FORCE_LOCK);
  return count;
}

async function redisClearFailedAttempts(key) {
  const r = getRedis();
  if (!r) return null;
  await r.del(`otp_fail:${key}`);
  return true;
}

/* ───────── MongoDB fallback implementations ───────── */

async function mongoStoreOTP(key, otp) {
  const db = getDB();
  const hashed = hashOTP(otp);
  await db.collection('otps').updateOne(
    { key },
    { $set: { key, otp: hashed, isHashed: true, expiresAt: new Date(Date.now() + OTP_TTL * 1000) } },
    { upsert: true }
  );
  return true;
}

async function mongoVerifyOTP(key, otp) {
  const db = getDB();
  const doc = await db.collection('otps').findOne({ key });
  if (!doc) return { found: false };
  if (new Date() > new Date(doc.expiresAt)) {
    await db.collection('otps').deleteOne({ key });
    return { found: true, match: false, expired: true };
  }
  let match;
  if (doc.isHashed) {
    match = compareOTP(otp, doc.otp);
  } else {
    match = String(doc.otp).trim() === String(otp).trim();
  }
  if (match) await db.collection('otps').deleteOne({ key });
  return { found: true, match };
}

async function mongoCheckRateLimit(key) {
  const db = getDB();
  const col = db.collection('otp_rate_limits');
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW * 1000);
  const doc = await col.findOne({ key });
  if (doc && new Date(doc.windowStart) > windowStart) {
    if (doc.count >= RATE_LIMIT_MAX) {
      const retryMs = new Date(doc.windowStart).getTime() + RATE_LIMIT_WINDOW * 1000 - Date.now();
      return { count: doc.count, limit: RATE_LIMIT_MAX, blocked: true, retryAfter: Math.ceil(retryMs / 1000) };
    }
    await col.updateOne({ key }, { $inc: { count: 1 } });
    return { count: doc.count + 1, limit: RATE_LIMIT_MAX, blocked: false, retryAfter: 0 };
  }
  await col.updateOne(
    { key },
    { $set: { key, count: 1, windowStart: new Date() } },
    { upsert: true }
  );
  return { count: 1, limit: RATE_LIMIT_MAX, blocked: false, retryAfter: 0 };
}

async function mongoCheckBruteForce(key) {
  const db = getDB();
  const col = db.collection('otp_brute_force');
  const doc = await col.findOne({ key });
  if (!doc) return { locked: false, attempts: 0 };
  const lockExpiry = new Date(doc.lockedUntil || 0);
  if (doc.attempts >= BRUTE_FORCE_MAX && lockExpiry > new Date()) {
    const retryMs = lockExpiry.getTime() - Date.now();
    return { locked: true, retryAfter: Math.ceil(retryMs / 1000), attempts: doc.attempts };
  }
  if (lockExpiry <= new Date() && doc.attempts >= BRUTE_FORCE_MAX) {
    await col.deleteOne({ key });
    return { locked: false, attempts: 0 };
  }
  return { locked: false, attempts: doc.attempts || 0 };
}

async function mongoRecordFailedAttempt(key) {
  const db = getDB();
  const col = db.collection('otp_brute_force');
  const result = await col.findOneAndUpdate(
    { key },
    {
      $inc: { attempts: 1 },
      $setOnInsert: { key, createdAt: new Date() },
    },
    { upsert: true, returnDocument: 'after' }
  );
  const doc = result.value || result;
  if (doc.attempts >= BRUTE_FORCE_MAX) {
    await col.updateOne({ key }, { $set: { lockedUntil: new Date(Date.now() + BRUTE_FORCE_LOCK * 1000) } });
  }
  return doc.attempts;
}

async function mongoClearFailedAttempts(key) {
  const db = getDB();
  await db.collection('otp_brute_force').deleteOne({ key });
  return true;
}

/* ───────── Unified API (auto-selects Redis or MongoDB) ───────── */

async function storeOTP(key, otp) {
  const ok = await redisStoreOTP(key, otp);
  if (ok) return;
  await mongoStoreOTP(key, otp);
}

async function verifyOTP(key, otp) {
  const redisResult = await redisVerifyOTP(key, otp);
  if (redisResult) return redisResult;
  return mongoVerifyOTP(key, otp);
}

async function checkRateLimit(key) {
  const redisResult = await redisCheckRateLimit(key);
  if (redisResult) return redisResult;
  return mongoCheckRateLimit(key);
}

async function checkBruteForce(key) {
  const redisResult = await redisCheckBruteForce(key);
  if (redisResult) return redisResult;
  return mongoCheckBruteForce(key);
}

async function recordFailedAttempt(key) {
  const count = await redisRecordFailedAttempt(key);
  if (count !== null) return count;
  return mongoRecordFailedAttempt(key);
}

async function clearFailedAttempts(key) {
  const ok = await redisClearFailedAttempts(key);
  if (ok) return;
  await mongoClearFailedAttempts(key);
}

module.exports = {
  storeOTP,
  verifyOTP,
  checkRateLimit,
  checkBruteForce,
  recordFailedAttempt,
  clearFailedAttempts,
  OTP_TTL,
};
