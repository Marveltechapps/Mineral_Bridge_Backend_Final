/**
 * Optional Redis client.
 * If REDIS_URL is set, connects to Redis for fast OTP/rate-limit storage.
 * Otherwise, exports null and the app falls back to MongoDB.
 */
let redis = null;
let redisReady = false;

function initRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  try {
    const Redis = require('ioredis');
    const client = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 200, 2000);
      },
      lazyConnect: false,
    });

    client.on('connect', () => {
      redisReady = true;
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Redis] Connected');
      }
    });

    client.on('error', (err) => {
      redisReady = false;
      if (process.env.NODE_ENV !== 'production') {
        console.error('[Redis] Error:', err.message);
      }
    });

    client.on('close', () => { redisReady = false; });

    redis = client;
    return client;
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Redis] ioredis not installed or failed to init — using MongoDB fallback');
    }
    return null;
  }
}

function getRedis() {
  return redisReady ? redis : null;
}

module.exports = { initRedis, getRedis };
