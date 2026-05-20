const express = require('express');
const http = require('http');
const https = require('https');

const router = express.Router();

const ALLOWED_HOST_SUFFIXES = [
  '.cloudfront.net',
  '.amazonaws.com',
];

function isAllowedHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return false;
  return ALLOWED_HOST_SUFFIXES.some((suf) => h === suf.slice(1) || h.endsWith(suf));
}

function safeParseUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    if (!/^https?:$/i.test(u.protocol)) return null;
    if (!isAllowedHost(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

/**
 * GET /api/media/proxy?url=https%3A%2F%2F...cloudfront...
 *
 * Workaround for networks/devices that cannot reach CloudFront directly.
 * The phone fetches from the backend (LAN reachable); backend fetches remote and streams bytes.
 *
 * Security: allowlist host suffixes; reject non-http(s).
 */
router.get('/proxy', async (req, res) => {
  const raw = req.query?.url;
  const u = safeParseUrl(raw);
  if (!u) return res.status(400).json({ error: 'Invalid or disallowed url' });

  const mod = u.protocol === 'https:' ? https : http;
  const upstreamReq = mod.request(
    u.toString(),
    {
      method: 'GET',
      headers: {
        // Some CDNs behave differently without UA; set a simple UA.
        'User-Agent': 'MineralBridgeMediaProxy/1.0',
        Accept: 'image/*,*/*;q=0.8',
      },
      timeout: 20000,
    },
    (upstream) => {
      const status = upstream.statusCode || 502;
      if (status >= 400) {
        res.status(status).json({ error: `Upstream returned ${status}` });
        upstream.resume();
        return;
      }
      const ct = upstream.headers['content-type'] || 'application/octet-stream';
      const cl = upstream.headers['content-length'];

      res.setHeader('Content-Type', ct);
      if (cl) res.setHeader('Content-Length', cl);
      // Cache on device for 1 day; CDN is immutable anyway.
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('X-Proxy-By', 'mineral-bridge');
      upstream.pipe(res);
    }
  );

  upstreamReq.on('timeout', () => {
    upstreamReq.destroy(new Error('Upstream timeout'));
  });
  upstreamReq.on('error', (err) => {
    if (!res.headersSent) res.status(502).json({ error: err.message || 'Proxy failed' });
  });
  upstreamReq.end();
});

module.exports = router;

