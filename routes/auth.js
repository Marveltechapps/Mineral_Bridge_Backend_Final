const express = require('express');
const { getDB } = require('../config/db');
const { checkBruteForce, recordFailedAttempt, clearFailedAttempts } = require('../services/otp.service');
const { generateAccessToken, generateRefreshToken, verifyToken } = require('../services/jwt.service');
const { createAlert } = require('./security_alerts');
const {
  deliverPhoneOtp,
  deliveryFailureMessage,
  buildPhoneOtpSuccessPayload,
} = require('../services/phone-otp-delivery.service');

const router = express.Router();

/* ───────── OTP Generator (4-digit, 1000–9999) per workflow spec ───────── */

function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

const OTP_EXPIRY_MINUTES = 5;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ───────── Helpers ───────── */

function getOtpKey(dial, digits) {
  let d = String(digits).replace(/\D/g, '') || digits;
  const norm = (dial || '').replace(/\s/g, '');
  if (norm === '+91' && d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (norm === '+1' && d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return `${norm || '+91'}|${d}`;
}

function extractEmail(body) {
  const raw = body?.email != null ? String(body.email).trim() : '';
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (!EMAIL_REGEX.test(lower)) return null;
  return lower;
}

function getEmailOtpKey(emailLower) {
  return `email|${String(emailLower).trim().toLowerCase()}`;
}

const EMAIL_OTP_SUBJECT = 'Your Mineral Bridge verification OTP';

function buildEmailOtpHtml(otp) {
  return `<p>Your Mineral Bridge one-time verification OTP is:</p><p style="font-size:24px;font-weight:700;letter-spacing:2px">${otp}</p><p>This code expires in ${OTP_EXPIRY_MINUTES} minutes.</p>`;
}

/** Resend (cloud) — set RESEND_API_KEY. */
async function sendEmailOtpViaResend(toEmail, otp) {
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const configuredFrom = String(process.env.RESEND_FROM || '').trim();
  const looksLikePersonalDomain = /<(?:[^>]+@)?(?:gmail\.com|yahoo\.com|outlook\.com|hotmail\.com|live\.com)\s*>$/i.test(configuredFrom)
    || /@(gmail\.com|yahoo\.com|outlook\.com|hotmail\.com|live\.com)\b/i.test(configuredFrom);
  const from = configuredFrom && !looksLikePersonalDomain
    ? configuredFrom
    : 'Mineral Bridge <onboarding@resend.dev>';
  const result = await resend.emails.send({
    from,
    to: toEmail,
    subject: EMAIL_OTP_SUBJECT,
    html: buildEmailOtpHtml(otp),
  });
  if (result?.error) {
    console.warn('[OTP] Resend error:', result.error);
    return false;
  }
  return true;
}

/** SMTP (Gmail app password, SendGrid SMTP, Mailgun, etc.) — set SMTP_HOST, SMTP_USER, SMTP_PASS. */
async function sendEmailOtpViaSmtp(toEmail, otp) {
  const nodemailer = require('nodemailer');
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  const from = String(process.env.SMTP_FROM || process.env.SMTP_USER || '').trim();
  if (!from) {
    console.error('[OTP] SMTP_FROM or SMTP_USER must be set for SMTP email');
    return false;
  }
  await transporter.sendMail({
    from: from.includes('<') ? from : `Mineral Bridge <${from}>`,
    to: toEmail,
    subject: EMAIL_OTP_SUBJECT,
    html: buildEmailOtpHtml(otp),
  });
  return true;
}

async function sendEmailOtp(toEmail, otp) {
  if (process.env.RESEND_API_KEY) {
    try {
      const ok = await sendEmailOtpViaResend(toEmail, otp);
      if (ok) return true;
    } catch (e) {
      console.error('[OTP] Resend send failed:', e);
    }
  }

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      return await sendEmailOtpViaSmtp(toEmail, otp);
    } catch (e) {
      console.error('[OTP] SMTP send failed:', e);
      return false;
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log('[OTP] No RESEND_API_KEY or SMTP_*; Email OTP for', toEmail, ':', otp);
    return true;
  }

  if (String(process.env.EMAIL_OTP_DEV_LOG || '').trim() === '1') {
    console.warn('[OTP] EMAIL_OTP_DEV_LOG=1 — logging OTP (disable in real production):', toEmail, otp);
    return true;
  }

  console.error(
    '[OTP] Email not configured: set RESEND_API_KEY, or SMTP_HOST + SMTP_USER + SMTP_PASS (see backend/.env.example)'
  );
  return false;
}

function extractMobile(body) {
  if (body.mobileNumber) {
    const digits = String(body.mobileNumber).replace(/\D/g, '');
    return { dial: '+91', digits };
  }
  const digits = String(body.phone || '').replace(/\D/g, '');
  const dial = (body.countryCode || '+91').replace(/\s/g, '');
  return { dial, digits };
}

/* ───────── Sample African test numbers (dev/test only) ─────────
 * Use these 10 numbers with their country code to test OTP login.
 * OTP for all: 1234
 * Remove or override in production (no env used; fixed list only).
 */
const SAMPLE_AFRICAN_TEST_NUMBERS = [
  { countryCode: '+233', phone: '201234567', country: 'Ghana', otp: '1234' },
  { countryCode: '+254', phone: '712345678', country: 'Kenya', otp: '1234' },
  { countryCode: '+255', phone: '712345678', country: 'Tanzania', otp: '1234' },
  { countryCode: '+234', phone: '8012345678', country: 'Nigeria', otp: '1234' },
  { countryCode: '+27', phone: '821234567', country: 'South Africa', otp: '1234' },
  { countryCode: '+256', phone: '712345678', country: 'Uganda', otp: '1234' },
  { countryCode: '+260', phone: '971234567', country: 'Zambia', otp: '1234' },
  { countryCode: '+263', phone: '712345678', country: 'Zimbabwe', otp: '1234' },
  { countryCode: '+221', phone: '701234567', country: 'Senegal', otp: '1234' },
  { countryCode: '+251', phone: '911234567', country: 'Ethiopia', otp: '1234' },
];

function getDevOtp(dial, digits, key) {
  if (process.env.NODE_ENV === 'production') return null;
  const normalizedDial = (dial || '').replace(/\s/g, '');
  const normalizedDigits = String(digits || '').replace(/\D/g, '');
  for (const entry of SAMPLE_AFRICAN_TEST_NUMBERS) {
    const entryKey = getOtpKey(entry.countryCode, entry.phone);
    if (key === entryKey) return entry.otp;
    if (normalizedDial === entry.countryCode.replace(/\s/g, '') && normalizedDigits === String(entry.phone).replace(/\D/g, '')) return entry.otp;
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════
   ROUTES — OTP Flow (per OTP_PROCESS_WORKFLOW spec)
   ═══════════════════════════════════════════════════════════ */

/**
 * POST /api/auth/send-otp
 * Body: { mobileNumber } OR { countryCode, phone }
 *
 * 1. Validate mobile (10 digits, not all zeros)
 * 2. Find or create user
 * 3. Generate 4-digit OTP + 5 min expiry
 * 4. Send SMS via gateway
 * 5. Only save OTP on user if SMS succeeds
 */
router.post('/send-otp', async (req, res) => {
  try {
    const body = req.body || {};
    const emailLower = extractEmail(body);
    const preferredChannel = (body.preferredChannel || '').toLowerCase();

    // Email OTP flow
    if (emailLower || preferredChannel === 'email') {
      if (!emailLower) {
        return res.status(400).json({ error: 'Valid email address required' });
      }

      const key = getEmailOtpKey(emailLower);

      const db = getDB();
      const users = db.collection('users');

      let user = await users.findOne({ phone: key });
      if (!user) {
        const doc = {
          phone: key,
          countryCode: '',
          mobileNumber: '',
          name: '',
          email: emailLower,
          otp: null,
          otpExpiry: null,
          isVerified: false,
          createdAt: new Date(),
        };
        const ins = await users.insertOne(doc);
        user = { _id: ins.insertedId, ...doc };
      } else if (!user.email) {
        await users.updateOne({ _id: user._id }, { $set: { email: emailLower } });
      }

      const otp = generateOTP();
      const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
      const ok = await sendEmailOtp(emailLower, otp);
      if (!ok) {
        return res.status(503).json({
          error: 'Email not configured',
          message:
            'Email OTP needs RESEND_API_KEY (Resend) or SMTP_HOST + SMTP_USER + SMTP_PASS (see backend/.env.example). For local testing only: EMAIL_OTP_DEV_LOG=1.',
        });
      }

      await users.updateOne({ _id: user._id }, { $set: { otp, otpExpiry } });
      return res.json({ message: 'OTP sent successfully', channel: 'email' });
    }

    const { dial, digits } = extractMobile(body);

    if (!digits || digits.length < 8 || /^0+$/.test(digits)) {
      return res.status(400).json({ error: 'Valid mobile number required (e.g. 9 digits for Ghana)' });
    }

    const key = getOtpKey(dial, digits);

    const db = getDB();
    const users = db.collection('users');

    let user = await users.findOne({ phone: key });
    if (!user) {
      const doc = {
        phone: key,
        countryCode: dial,
        mobileNumber: digits,
        name: '',
        email: '',
        otp: null,
        otpExpiry: null,
        isVerified: false,
        createdAt: new Date(),
      };
      const ins = await users.insertOne(doc);
      user = { _id: ins.insertedId, ...doc };
    }

    const otp = getDevOtp(dial, digits, key) || generateOTP();
    const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    const delivered = await deliverPhoneOtp({ dial, digits, otp, preferredChannel });
    if (!delivered.ok) {
      return res.status(500).json({
        error: 'Failed to send OTP',
        message: deliveryFailureMessage(delivered.reason),
      });
    }

    await users.updateOne({ _id: user._id }, { $set: { otp, otpExpiry } });

    res.json(
      buildPhoneOtpSuccessPayload({
        otp,
        channel: delivered.channel,
        expiresInMinutes: OTP_EXPIRY_MINUTES,
        dial,
        digits,
        preferredChannel,
      })
    );
  } catch (err) {
    console.error('send-otp error:', err);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

/**
 * POST /api/auth/verify-otp
 * Body: { mobileNumber, otp|enteredOTP } OR { countryCode, phone, otp|enteredOTP }
 *
 * 1. Find user
 * 2. Check OTP exists, not expired, matches
 * 3. Clear user.otp, set isVerified
 * 4. Generate JWT
 * 5. Return token + user info
 */
router.post('/verify-otp', async (req, res) => {
  try {
    const body = req.body || {};
    const enteredOTP = body.otp || body.enteredOTP;
    const emailLower = extractEmail(body);
    const { dial, digits } = extractMobile(body);

    if (!enteredOTP) {
      return res.status(400).json({ message: 'OTP is required' });
    }

    const key = emailLower ? getEmailOtpKey(emailLower) : getOtpKey(dial, digits);
    if (!key || (!emailLower && !digits)) {
      return res.status(400).json({ message: emailLower ? 'Email required' : 'Mobile number required' });
    }

    const bf = await checkBruteForce(key);
    if (bf.locked) {
      return res.status(429).json({
        error: 'Too many failed attempts. Account temporarily locked.',
        retryAfter: bf.retryAfter,
      });
    }

    const db = getDB();
    const users = db.collection('users');
    const user = await users.findOne({ phone: key });

    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }
    if (!user.otp) {
      return res.status(400).json({ message: 'No OTP found. Request OTP first.' });
    }
    if (new Date() > new Date(user.otpExpiry)) {
      await users.updateOne({ _id: user._id }, { $set: { otp: null, otpExpiry: null } });
      return res.status(400).json({ message: 'OTP expired' });
    }
    if (String(user.otp).trim() !== String(enteredOTP).trim()) {
      await recordFailedAttempt(key);
      return res.status(400).json({ message: 'Incorrect OTP' });
    }

    await clearFailedAttempts(key);

    const uid = String(user._id);
    const accessProfile = await db.collection('profiles').findOne({ userId: uid });
    const accountStatus = String(accessProfile?.accountStatus || 'active').toLowerCase();
    if (accountStatus === 'restricted' || accountStatus === 'suspended') {
      return res.status(403).json({
        error: 'Account restricted',
        message: 'Your account has been restricted. Contact Mineral Bridge support.',
        code: 'account_restricted',
        accountStatus,
      });
    }

    const kycStatus = String(accessProfile?.kycStatus || 'pending').toLowerCase();
    if (kycStatus === 'rejected') {
      return res.status(403).json({
        error: 'KYC rejected',
        message:
          accessProfile?.kycRejectionReason ||
          'Your identity verification was rejected. Contact Mineral Bridge support.',
        code: 'kyc_rejected',
        kycStatus: 'rejected',
        kycRejectionReason: accessProfile?.kycRejectionReason || null,
      });
    }

    const isVerified = !!(user.name && user.name.trim());
    await users.updateOne(
      { _id: user._id },
      { $set: { otp: null, otpExpiry: null, isVerified } }
    );

    const tokenPayload = { userId: uid, phone: user.phone, email: user.email || null };
    const token = generateAccessToken(tokenPayload);
    const refresh = generateRefreshToken(tokenPayload);

    await db.collection('refresh_tokens').updateOne(
      { userId: uid, tokenId: refresh.tokenId },
      { $set: { userId: uid, tokenId: refresh.tokenId, createdAt: new Date() } },
      { upsert: true }
    );

    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';
    await db.collection('login_history').insertOne({
      userId: uid, ip, userAgent: ua, loggedInAt: new Date(),
    });

    const prevLogins = await db.collection('login_history')
      .find({ userId: uid }).sort({ loggedInAt: -1 }).limit(10).toArray();

    const knownIPs = new Set(prevLogins.slice(1).map((l) => l.ip));
    if (prevLogins.length > 1 && !knownIPs.has(ip)) {
      await createAlert(uid, {
        type: 'new_login_ip',
        title: 'New sign-in detected',
        message: `Sign-in from a new location (IP ${ip}). Verify this was you.`,
        severity: 'warning',
      });
    }

    const knownUAs = new Set(prevLogins.slice(1).map((l) => l.userAgent));
    if (prevLogins.length > 1 && !knownUAs.has(ua) && ua) {
      await createAlert(uid, {
        type: 'new_device',
        title: 'New device sign-in',
        message: 'Unrecognized device used to access your account. Review your active sessions.',
        severity: 'warning',
      });
    }

    if (!user.name && !user.email) {
      await createAlert(uid, {
        type: 'profile_incomplete',
        title: 'Complete your profile',
        message: 'Add your name and email to strengthen your account and enable recovery options.',
        severity: 'info',
      });
    }

    res.json({
      message: 'OTP verified successfully',
      userId: uid,
      token,
      accessToken: token,
      refreshToken: refresh.token,
      isVerified,
      name: user.name || null,
      user: {
        id: uid,
        phone: user.phone,
        countryCode: user.countryCode,
        name: user.name,
        email: user.email,
      },
    });
  } catch (err) {
    console.error('verify-otp error:', err);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

/**
 * POST /api/auth/resend-otp
 * Body: { mobileNumber } OR { countryCode, phone }
 *
 * User must already exist (created by send-otp).
 * Generates new OTP + expiry, sends SMS, updates user.
 */
router.post('/resend-otp', async (req, res) => {
  try {
    const body = req.body || {};
    const emailLower = extractEmail(body);
    const { dial, digits } = extractMobile(body);
    const key = emailLower ? getEmailOtpKey(emailLower) : getOtpKey(dial, digits);
    if (!key || (!emailLower && !digits)) return res.status(400).json({ error: emailLower ? 'Email required' : 'Mobile number required' });

    const db = getDB();
    const user = await db.collection('users').findOne({ phone: key });

    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    const otp = emailLower ? generateOTP() : (getDevOtp(dial, digits, key) || generateOTP());
    const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    let channel = null;
    if (emailLower) {
      const ok = await sendEmailOtp(emailLower, otp);
      channel = 'email';
      if (!ok) {
        return res.status(503).json({
          error: 'Email not configured',
          message:
            'Email OTP needs RESEND_API_KEY (Resend) or SMTP_HOST + SMTP_USER + SMTP_PASS (see backend/.env.example). For local testing only: EMAIL_OTP_DEV_LOG=1.',
        });
      }
    } else {
      const phonePreferred = (body.preferredChannel || 'whatsapp').toLowerCase();
      const delivered = await deliverPhoneOtp({ dial, digits, otp, preferredChannel: phonePreferred });
      if (!delivered.ok) {
        return res.status(500).json({
          error: 'Failed to resend OTP',
          message: deliveryFailureMessage(delivered.reason),
        });
      }
      channel = delivered.channel;
    }

    await db.collection('users').updateOne(
      { _id: user._id },
      { $set: { otp, otpExpiry } }
    );

    if (emailLower) {
      return res.json({ message: 'OTP resent successfully', channel, expiresInSeconds: OTP_EXPIRY_MINUTES * 60 });
    }

    return res.json(
      buildPhoneOtpSuccessPayload({
        otp,
        channel,
        expiresInMinutes: OTP_EXPIRY_MINUTES,
        dial,
        digits,
        preferredChannel: phonePreferred,
      })
    );
  } catch (err) {
    console.error('resend-otp error:', err);
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
});

/* ═══════════════════════════════════════════════════════════
   ROUTES — Token Refresh & User Management
   ═══════════════════════════════════════════════════════════ */

/**
 * POST /api/auth/refresh-token
 * Body: { refreshToken }
 */
router.post('/refresh-token', async (req, res) => {
  try {
    const { refreshToken: rt } = req.body || {};
    if (!rt) return res.status(400).json({ error: 'Refresh token required' });

    let decoded;
    try {
      decoded = verifyToken(rt);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    if (decoded.type !== 'refresh') {
      return res.status(401).json({ error: 'Not a refresh token' });
    }

    const db = getDB();
    const stored = await db.collection('refresh_tokens').findOne({
      userId: decoded.userId,
      tokenId: decoded.jti,
    });
    if (!stored) {
      return res.status(401).json({ error: 'Refresh token revoked or not found' });
    }

    const newAccess = generateAccessToken({ userId: decoded.userId, phone: decoded.phone });

    res.json({
      token: newAccess,
      accessToken: newAccess,
      tokenType: 'Bearer',
      expiresIn: parseExpiresIn(process.env.JWT_ACCESS_EXPIRES || '30d'),
    });
  } catch (err) {
    console.error('refresh-token error:', err);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

/**
 * POST /api/auth/register-or-login
 * Body: { countryCode, phone, name?, email?, location? }
 */
router.post('/register-or-login', async (req, res) => {
  try {
    const { countryCode, phone, name, email, location } = req.body || {};
    if (!phone || String(phone).replace(/\D/g, '').length < 9) {
      return res.status(400).json({ error: 'Valid phone number required' });
    }
    const db = getDB();
    const users = db.collection('users');
    const normalizedPhone = `${countryCode || '+91'}|${String(phone).replace(/\D/g, '')}`;
    let user = await users.findOne({ phone: normalizedPhone });
    if (!user) {
      const insert = {
        phone: normalizedPhone,
        countryCode: countryCode || '+91',
        name: name || '',
        email: email || '',
        location: location || null,
        otp: null,
        otpExpiry: null,
        isVerified: false,
        createdAt: new Date(),
      };
      const result = await users.insertOne(insert);
      user = { _id: result.insertedId, ...insert };
    } else {
      const update = {};
      const changedFields = [];
      if (name !== undefined && name !== user.name) { update.name = name; changedFields.push('name'); }
      if (email !== undefined && email !== user.email) { update.email = email; changedFields.push('email'); }
      if (location !== undefined) update.location = location;
      if (Object.keys(update).length) {
        await users.updateOne({ _id: user._id }, { $set: update });
        user = { ...user, ...update };
      }
      if (changedFields.length) {
        await createAlert(String(user._id), {
          type: 'profile_updated',
          title: 'Profile details updated',
          message: `Your ${changedFields.join(' and ')} ${changedFields.length > 1 ? 'were' : 'was'} recently updated. If you didn't make this change, review your account settings immediately.`,
          severity: 'warning',
        });
      }
    }
    const token = generateAccessToken({ userId: String(user._id), phone: user.phone });
    res.json({
      token,
      user: {
        id: String(user._id),
        phone: user.phone,
        countryCode: user.countryCode,
        name: user.name,
        email: user.email,
      },
    });
  } catch (err) {
    console.error('register-or-login error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * GET /api/auth/me
 */
router.get('/me', require('../middleware/auth').authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const user = await db.collection('users').findOne({
      _id: new (require('mongodb').ObjectId)(req.user.id),
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const lastLogin = await db
      .collection('login_history')
      .findOne({ userId: req.user.id }, { sort: { loggedInAt: -1 } });

    const currentUA = req.headers['user-agent'] || '';
    const deviceName = parseDeviceName(currentUA);
    const lastIP = lastLogin?.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';

    res.json({
      id: String(user._id),
      phone: user.phone,
      countryCode: user.countryCode,
      name: user.name || '',
      email: user.email || '',
      twoFactorEnabled: !!user.twoFactorEnabled,
      deviceName,
      lastIP,
      lastLocation: lastIP || '',
      lastLoginAt: lastLogin?.loggedInAt || null,
    });
  } catch (err) {
    console.error('GET /auth/me error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

function parseDeviceName(ua) {
  if (!ua) return 'Unknown Device';
  if (/iPhone/i.test(ua)) {
    const m = ua.match(/iPhone\s?(?:OS\s)?([\d_]+)/i);
    return m ? `iPhone (iOS ${m[1].replace(/_/g, '.')})` : 'iPhone';
  }
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) {
    const m = ua.match(/Android\s([\d.]+)/i);
    return m ? `Android ${m[1]}` : 'Android Device';
  }
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Mac/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux';
  if (/Expo/i.test(ua) || /okhttp/i.test(ua)) return 'Mobile App';
  return 'Unknown Device';
}

/**
 * PUT /api/auth/2fa
 */
router.put('/2fa', require('../middleware/auth').authMiddleware, async (req, res) => {
  try {
    const { enabled } = req.body || {};
    const db = getDB();
    await db.collection('users').updateOne(
      { _id: new (require('mongodb').ObjectId)(req.user.id) },
      { $set: { twoFactorEnabled: !!enabled, updatedAt: new Date() } },
    );
    res.json({ success: true, twoFactorEnabled: !!enabled });
  } catch (err) {
    console.error('PUT /auth/2fa error:', err);
    res.status(500).json({ error: 'Failed to update 2FA setting' });
  }
});

/**
 * GET /api/auth/sessions
 */
router.get('/sessions', require('../middleware/auth').authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const sessions = await db
      .collection('login_history')
      .find({ userId: req.user.id })
      .sort({ loggedInAt: -1 })
      .limit(20)
      .toArray();

    res.json(
      sessions.map((s) => ({
        id: s._id.toString(),
        ip: s.ip || '',
        deviceName: parseDeviceName(s.userAgent),
        userAgent: s.userAgent || '',
        loggedInAt: s.loggedInAt,
        isCurrent:
          s.userAgent === (req.headers['user-agent'] || '') &&
          s.ip === (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || ''),
      })),
    );
  } catch (err) {
    console.error('GET /auth/sessions error:', err);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

/**
 * DELETE /api/auth/sessions/:id
 */
router.delete('/sessions/:id', require('../middleware/auth').authMiddleware, async (req, res) => {
  try {
    const { ObjectId } = require('mongodb');
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid session id' });

    const db = getDB();
    await db.collection('login_history').deleteOne({ _id: new ObjectId(id), userId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /auth/sessions/:id error:', err);
    res.status(500).json({ error: 'Failed to revoke session' });
  }
});

/* ───────── Helpers ───────── */

function parseExpiresIn(str) {
  if (!str) return 2592000;
  const m = str.match(/^(\d+)(s|m|h|d)$/);
  if (!m) return 2592000;
  const num = parseInt(m[1], 10);
  switch (m[2]) {
    case 's': return num;
    case 'm': return num * 60;
    case 'h': return num * 3600;
    case 'd': return num * 86400;
    default: return 2592000;
  }
}

module.exports = router;
