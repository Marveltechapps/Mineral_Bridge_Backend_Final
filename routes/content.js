/**
 * Content API: dashboard-driven copy, images, and options for app modules (e.g. Buy).
 * All data in the Buy module can come from dashboard (content + minerals) or app (user/address/order).
 * GET is public so the app can fetch; PATCH is authenticated for dashboard updates.
 */
const express = require('express');
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { presignedUrl } = require('../config/s3');

const router = express.Router();
const BANNER_CACHE_META_KEY = 'banner_cache_meta';

// In-memory cache for banner presigned URLs.
const BANNER_PRESIGN_CACHE_MS = 60 * 60 * 1000; // 1 hour
const bannerPresignCache = new Map(); // imageKey -> { url, expiresAt }

async function getCachedBannerImageUrl(imageKey, fallbackUrl = '') {
  const key = String(imageKey || '').trim();
  if (!key) return fallbackUrl || '';
  const now = Date.now();
  const cached = bannerPresignCache.get(key);
  if (cached && cached.expiresAt > now && cached.url) return cached.url;
  const signed = await presignedUrl(key, { scope: 'admin', expiresIn: 86400 });
  bannerPresignCache.set(key, { url: signed, expiresAt: now + BANNER_PRESIGN_CACHE_MS });
  return signed;
}

async function getBannerCacheVersion(db) {
  const meta = await db.collection('content').findOne({ key: BANNER_CACHE_META_KEY });
  const version = meta?.value?.version || '';
  if (version) return String(version);
  const latest = await db.collection('banners').find({}, { projection: { updatedAt: 1, createdAt: 1 } }).sort({ updatedAt: -1, createdAt: -1 }).limit(1).toArray();
  const d = latest?.[0]?.updatedAt || latest?.[0]?.createdAt || new Date(0);
  return String(new Date(d).getTime());
}

const CONTENT_KEY_BUY = 'buy';
const CONTENT_KEY_SELL = 'sell';

function stripCloudfrontVParam(url) {
  if (url == null) return url;
  if (typeof url !== 'string') return url;
  const raw = url.trim();
  if (!raw) return url;
  const lower = raw.toLowerCase();
  if (!lower.includes('.cloudfront.net/')) return url;
  if (!/([?&])v=/.test(raw)) return url;
  try {
    const u = new URL(raw);
    u.searchParams.delete('v');
    return u.toString();
  } catch {
    return raw.replace(/([?&])v=[^&]*/i, '$1').replace(/[?&]$/, '');
  }
}

function stripVFromBuyContentImages(obj) {
  if (!obj || typeof obj !== 'object') return;
  // Buy home category tiles
  if (obj.buyCategoryImages && typeof obj.buyCategoryImages === 'object') {
    for (const k of Object.keys(obj.buyCategoryImages)) {
      obj.buyCategoryImages[k] = stripCloudfrontVParam(obj.buyCategoryImages[k]);
    }
  }
  // Buy home sub-category tiles
  if (obj.buySubCategoryImages && typeof obj.buySubCategoryImages === 'object') {
    for (const g of Object.keys(obj.buySubCategoryImages)) {
      const group = obj.buySubCategoryImages[g];
      if (!group || typeof group !== 'object') continue;
      for (const k of Object.keys(group)) {
        group[k] = stripCloudfrontVParam(group[k]);
      }
    }
  }
  // Optional Buy banner image
  if (obj.bannerImageUrl) obj.bannerImageUrl = stripCloudfrontVParam(obj.bannerImageUrl);
  // Optional categoryDisplay images
  if (obj.categoryDisplay && typeof obj.categoryDisplay === 'object') {
    for (const k of Object.keys(obj.categoryDisplay)) {
      const item = obj.categoryDisplay[k];
      if (item && typeof item === 'object' && item.imageUrl) {
        item.imageUrl = stripCloudfrontVParam(item.imageUrl);
      }
    }
  }
}

/** Default Buy module content. App uses these when DB has no overrides. */
const BUY_CONTENT_DEFAULTS = {
  // Buy list (BuyScreen): banner and search
  bannerImageUrl: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800',
  searchPlaceholder: 'Search mineral, metal, or category...',

  // Category display: displayName (e.g. "Gold") and optional imageUrl per category. App shows this for section header; tap opens that category's products.
  categoryDisplay: {
    'Precious metals': { displayName: 'Gold', imageUrl: '' },
    'Gemstone': { displayName: 'Diamond', imageUrl: '' },
    'Industrial Mineral': { displayName: 'Industrial Mineral', imageUrl: '' },
    'Critical Mineral': { displayName: 'Critical Mineral', imageUrl: '' },
    'Energy Mineral': { displayName: 'Energy Mineral', imageUrl: '' },
  },

  /** Buy home: canonical category tile images (dashboard / master sheet "Category URL"). Keys match getCategoryDisplayName labels. */
  buyCategoryImages: {
    'Precious Metal':
      'https://d28izrv1rzt34w.cloudfront.net/website/Category%20folder/Precoius%20meta_%20-%20Category.png?w=400&q=60',
    Gemstone:
      'https://d28izrv1rzt34w.cloudfront.net/website/Category%20folder/Gemstone.png?w=400&q=60',
    'Industrial Mineral':
      'https://d28izrv1rzt34w.cloudfront.net/website/Category%20folder/Industrial%20material%20category.png?w=400&q=60',
    'Critical Mineral':
      'https://d28izrv1rzt34w.cloudfront.net/website/Category%20folder/Crtical%20Minerals%20-%20category.png?w=400&q=60',
    'Energy Mineral':
      'https://d28izrv1rzt34w.cloudfront.net/website/Category%20folder/Energy%20Mineral.png?w=400&q=60',
  },

  /** Buy home: sub-category tile images keyed by canonical category → sub labels (master sheet “Category display Image”). */
  buySubCategoryImages: {
    'Precious Metal': {
      Gold:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Precious%20metal%20sub%20cat/Gold%20sub%20category.png?w=400&q=60',
      Platinum:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Precious%20metal%20sub%20cat/Platinum%20sub%20category.png?w=400&q=60',
      Silver:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Precious%20metal%20sub%20cat/Silver%20sub%20category.png?w=400&q=60',
    },
    'Critical Mineral': {
      /** CDN paths are literal filenames; typos/spacing must match S3 objects. */
      Lithium:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Critical%20mineral/Lithium%20%20sub%20category.png?w=400&q=60',
      Cobalt:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Critical%20mineral/Cobalt-%20sub%20category.png?w=400&q=60',
      Aluminum:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Critical%20mineral/Aluminium%20sub%20category.png?w=400&q=60',
      Aluminium:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Critical%20mineral/Aluminium%20sub%20category.png?w=400&q=60',
      Copper:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Critical%20mineral/Copper%20-%20sub%20category.png?w=400&q=60',
      Zinc:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Critical%20mineral/Zinc%20subcategory.png?w=400&q=60',
      Nickel:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Critical%20mineral/Nickel%20sub%20category.png?w=400&q=60',
      Tungsten:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Critical%20mineral/Tungsten%20sub%20category.png?w=400&q=60',
      Phosphate:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Critical%20mineral/Phosphate%20sub%20category.png?w=400&q=60',
      Manganese:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Critical%20mineral/Manganese%20sub%20actegory.png?w=400&q=60',
      Graphite:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Critical%20mineral/Graphite%20sub%20category.png?w=400&q=60',
      Bauxite:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Critical%20mineral/Bauxite%20sub%20category.png?w=400&q=60',
      Chromite:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Critical%20mineral/Chromite%20sub%20category.png?w=400&q=60',
      Vanadium:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Critical%20mineral/Vanadium%20sub%20category.png?w=400&q=60',
    },
    Gemstone: {
      Diamond:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Gemstone/Diamond/Diamond%20sub%20category.png?w=400&q=60',
      Jadeite:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory+folder/Gemstone/Jadeite.png?w=400&q=60',
      Emerald:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory+folder/Gemstone/Emerald.png?w=400&q=60',
      Taaffeite:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Gemstone/Taaffeite.png?w=400&q=60',
      Grandidierite:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Gemstone/Grandidierite.png?w=400&q=60',
      Serendibite:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Gemstone/Serendibite.png?w=400&q=60',
      Ruby:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory+folder/Gemstone/Ruby.png?w=400&q=60',
      Musgravite:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Gemstone/Musgravite.png?w=400&q=60',
      'Red Beryl':
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory+folder/Gemstone/Red%2BBeryl.png?w=400&q=60',
      Benitoite:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Gemstone/Benitoite.png?w=400&q=60',
      Poudretteite:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory+folder/Gemstone/Poudretteite.png?w=400&q=60',
      Jeremejevite:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Gemstone/Jeremejevite+(1).png?w=400&q=60',
      Alexandrite:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Gemstone/Alexandrite.png?w=400&q=60',
      'Black Opal':
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory+folder/Gemstone/Black+Opal.png?w=400&q=60',
      'Fire Opal':
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory+folder/Gemstone/Fire+Opal.png?w=400&q=60',
      Tanzanite:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Gemstone/Tanzanite.png?w=400&q=60',
      /** Same CDN asset as Industrial when catalog lists Silica Sand under Gemstone (see MINERAL-CATEGORIES-REFERENCE). */
      'Silica Sand':
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Industrial%20mineral/Silica%20sand%20sub%20category.png?w=400&q=60',
    },
    'Industrial Mineral': {
      'Silica Sand':
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Industrial%20mineral/Silica%20sand%20sub%20category.png?w=400&q=60',
      Iron:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Industrial%20mineral/Iron%20sub%20category.png?w=400&q=60',
      Limestone:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Industrial%20mineral/Limestone%20sub%20category.png?w=400&q=60',
      Kyanite:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Industrial%20mineral/Kyanite%20sub%20category.png?w=400&q=60',
      Magnesite:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Industrial%20mineral/Magnesite%20sub%20category.png?w=400&q=60',
      Mica:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Industrial%20mineral/Mica%20sub%20category.png?w=400&q=60',
      'Quartz & Feldspar':
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Industrial%20mineral/7.Quartz%20%26%20Feldspar%20sub%20category.png?w=400&q=60',
      'Soapstone (Talc)':
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Industrial%20mineral/Soapstone%20sub%20category.png?w=400&q=60',
      Sulphur:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Industrial%20mineral/9.Sulphur%20sub%20category.png?w=400&q=60',
      Sulfur:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Industrial%20mineral/9.Sulphur%20sub%20category.png?w=400&q=60',
      Vermiculite:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Industrial%20mineral/10.Vermiculite%20sub%20category.png?w=400&q=60',
      Dolomite:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Industrial%20mineral/Dolomite%20sub%20category.png?w=400&q=60',
      Gypsum:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Industrial%20mineral/Gypsum%20sub%20category.png?w=400&q=60',
    },
    'Energy Mineral': {
      Lignite:
        'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Energy%20mineral/Energy%20Mineral.png?w=400&q=60',
    },
  },

  // Quantity step (QuantityScreen)
  quantityStep: {
    stepLabel: 'STEP 1 OF 3',
    stepSublabel: '',
    mineralTypeOptions: ['Raw', 'Semi Finished', 'Finished'],
    buyerCategoryOptions: [
      'Legitimate B2B mineral suppliers',
      'Mining companies',
      'Traders',
      'Refineries',
      'Others',
    ],
    unitOptions: ['ct', 'g', 'kg', 'MT'],
    presetQuantities: [5, 10, 25, 50],
    lockPolicyText:
      'By proceeding, you secure a temporary allocation for this quantity. The spot price is locked for 24 hours until the trade is finalized.',
    defaultStock: '500',
  },

  // Delivery step (DeliveryScreen)
  deliveryStep: {
    stepLabel: 'STEP 2 OF 3',
    stepSublabel: 'Step 2 follow these steps',
    directDeliveryTitle: 'Direct Delivery',
    directDeliverySubtitle: 'Secure armored transport to your registered facility.',
    vaultTitle: 'Secure Vault',
    vaultSubtitle: 'Insured, bonded storage in Zurich or Singapore.',
    vaultPrice: '$200 / month',
    vaultComingSoon: true,
    complianceTitle: 'Regulatory compliance (if applicable)',
    complianceText:
      'If this applies to your institution, confirm adherence to safety, AML, and mineral handling regulations for this shipment.',
    formLabels: {
      facilityName: 'Facility/Business Name *',
      street: 'Street Address *',
      city: 'City *',
      stateRegion: 'State / Region *',
      postalCode: 'Postal Code *',
      country: 'Country *',
      phone: 'Contact Phone *',
      email: 'Email Address *',
      permitNumber: 'Institutional permit number (optional)',
      proofOfFacility: 'Proof of facility address (optional)',
    },
    saveForFutureTitle: 'Save for future orders',
    saveForFutureSub: 'Store this address in your institutional profile.',
    saveLocationButton: 'Save Location',
    newAddressButton: 'New Address',
  },

  // Payment step (PaymentScreen): defaults for transport/fee when not from dashboard
  paymentStep: {
    defaultTransport: 1200,
    feePercent: 0.01,
  },

  // Order confirmed / Success (OrderConfirmedScreen, SuccessScreen): optional copy or image URLs
  orderConfirmed: {
    title: 'Order Received',
    subtitle: null,
    checkImageUrl: null,
  },
  success: {
    title: 'Order placed',
    subtitle: 'Thank you. Full success screen in Module 2.',
  },

  // Tracking (TrackingScreen)
  tracking: {
    title: 'Order tracking',
  },
};

/** Default Sell module content. Dashboard can override via PATCH /api/content/sell. */
const SELL_CONTENT_DEFAULTS = {
  searchPlaceholder: 'Search mineral type...',
  whatAreYouSellingTitle: 'What are you selling?',
  acceptFormats: ['Raw', 'Semi-Processed', 'Processed'],
  requiredCompliance: [
    'Legal ownership documentation',
    'Ethical sourcing verification',
    'Free of conflict zone origin',
  ],
  stepLabels: { step1: 'STEP 1 OF 3', step2: 'STEP 2 OF 3', step3: 'STEP 3 OF 3' },
  saleConfirmed: {
    title: 'Sell request confirmation',
    subtitle: 'Your sell request has been received. Payment protected in escrow.',
  },
};

/**
 * DB may still hold pre-rename copy; deepMerge(stored, defaults) lets stored win.
 * Upgrade known legacy saleConfirmed strings to current defaults.
 */
function normalizeSaleConfirmedMerged(saleConfirmed) {
  const def = SELL_CONTENT_DEFAULTS.saleConfirmed;
  const out = saleConfirmed && typeof saleConfirmed === 'object' ? saleConfirmed : {};
  let title =
    out.title != null && String(out.title).trim() !== '' ? String(out.title).trim() : def.title;
  let subtitle =
    out.subtitle != null && String(out.subtitle).trim() !== ''
      ? String(out.subtitle).trim()
      : def.subtitle;
  if (/^sale\s+confirmed\.?$/i.test(title)) title = def.title;
  if (/^sale\s+confirmed\b/i.test(subtitle)) subtitle = def.subtitle;
  return { title, subtitle };
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  const out = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] != null && typeof source[key] === 'object' && !Array.isArray(source[key]) && typeof target[key] === 'object') {
      out[key] = deepMerge(out[key] || {}, source[key]);
    } else if (source[key] !== undefined) {
      out[key] = source[key];
    }
  }
  return out;
}

/** Old baked-in URLs pointed at wrong object keys (403). Replace only exact legacy strings so dashboard overrides stay intact. */
const LEGACY_CRITICAL_SUB_IMAGE_FIXES = {
  'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Critical%20mineral/Lithium%20sub%20category.png?w=400&q=60':
    'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Critical%20mineral/Lithium%20%20sub%20category.png?w=400&q=60',
  'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Critical%20mineral/Copper-%20sub%20category.png?w=400&q=60':
    'https://d28izrv1rzt34w.cloudfront.net/website/Subcategory%20folder/Critical%20mineral/Copper%20-%20sub%20category.png?w=400&q=60',
};

function normalizeBuyContentLegacyCriticalSubImages(merged) {
  const cm = merged?.buySubCategoryImages?.['Critical Mineral'];
  if (!cm || typeof cm !== 'object') return;
  for (const key of Object.keys(cm)) {
    const url = cm[key];
    if (typeof url !== 'string') continue;
    const trimmed = url.trim();
    const fixed = LEGACY_CRITICAL_SUB_IMAGE_FIXES[trimmed];
    if (fixed) cm[key] = fixed;
  }
}

/**
 * Many dashboard flows store S3 *presigned* URLs in DB (which expire).
 * The mobile app then receives expired URLs and cannot render images.
 * This normalizer converts known S3 URLs/keys into fresh presigned URLs at read time.
 */
function tryExtractS3KeyFromUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const s = rawUrl.trim();
  if (!/^https?:\/\//i.test(s)) return '';
  if (!/amazonaws\.com/i.test(s)) return '';
  try {
    const u = new URL(s);
    const path = (u.pathname || '').replace(/^\/+/, '');
    return path ? decodeURIComponent(path) : '';
  } catch {
    return '';
  }
}

function looksLikeS3PresignedUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const s = rawUrl.toLowerCase();
  return s.includes('amazonaws.com') && (s.includes('x-amz-signature=') || s.includes('x-amz-credential='));
}

async function freshenMaybeS3Url(val) {
  if (val == null) return val;
  if (typeof val !== 'string') return val;
  const s = val.trim();
  if (!s) return val;

  // If caller stored a raw S3 key, presign directly.
  if (!/^https?:\/\//i.test(s) && s.includes('/')) {
    try {
      return await presignedUrl(s, { scope: 'admin', expiresIn: 86400 });
    } catch {
      return val;
    }
  }

  // If caller stored a presigned S3 URL, extract key and re-presign.
  if (looksLikeS3PresignedUrl(s)) {
    const key = tryExtractS3KeyFromUrl(s);
    if (!key) return val;
    try {
      return await presignedUrl(key, { scope: 'admin', expiresIn: 86400 });
    } catch {
      return val;
    }
  }

  return val;
}

async function freshenBuyContentImageUrls(merged) {
  if (!merged || typeof merged !== 'object') return;

  // Top-level banner image (Buy screen).
  if (merged.bannerImageUrl) merged.bannerImageUrl = await freshenMaybeS3Url(merged.bannerImageUrl);

  // Optional order-confirmed image.
  if (merged.orderConfirmed?.checkImageUrl) {
    merged.orderConfirmed.checkImageUrl = await freshenMaybeS3Url(merged.orderConfirmed.checkImageUrl);
  }

  // Category tile images (Buy home).
  if (merged.buyCategoryImages && typeof merged.buyCategoryImages === 'object') {
    for (const k of Object.keys(merged.buyCategoryImages)) {
      merged.buyCategoryImages[k] = await freshenMaybeS3Url(merged.buyCategoryImages[k]);
    }
  }

  // Sub-category tile images (Buy home).
  const root = merged.buySubCategoryImages;
  if (root && typeof root === 'object') {
    for (const groupKey of Object.keys(root)) {
      const group = root[groupKey];
      if (!group || typeof group !== 'object') continue;
      for (const subKey of Object.keys(group)) {
        group[subKey] = await freshenMaybeS3Url(group[subKey]);
      }
    }
  }

  // Category display header images (optional).
  if (merged.categoryDisplay && typeof merged.categoryDisplay === 'object') {
    for (const k of Object.keys(merged.categoryDisplay)) {
      const item = merged.categoryDisplay[k];
      if (item && typeof item === 'object' && item.imageUrl) {
        item.imageUrl = await freshenMaybeS3Url(item.imageUrl);
      }
    }
  }
}

/**
 * GET /api/content/buy
 * Returns full Buy module content (text, image URLs, options). Public.
 * Merges DB-stored overrides with defaults. Dashboard and app both use this; app uses it so all copy and media can be driven from dashboard.
 */
router.get('/buy', async (req, res) => {
  try {
    const db = getDB();
    const doc = await db.collection('content').findOne({ key: CONTENT_KEY_BUY });
    const stored = (doc && doc.value) || {};
    const merged = deepMerge(BUY_CONTENT_DEFAULTS, stored);
    normalizeBuyContentLegacyCriticalSubImages(merged);
    await freshenBuyContentImageUrls(merged);
    // Version for cache-busting client image URLs. Changes whenever dashboard PATCHes /api/content/buy.
    const contentUpdatedAtMs = doc?.updatedAt ? new Date(doc.updatedAt).getTime() : 0;
    merged.contentVersion = String(contentUpdatedAtMs || 0);
    res.json(merged);
  } catch (err) {
    console.error('GET /content/buy error:', err);
    res.status(500).json({ error: 'Failed to fetch buy content' });
  }
});

/**
 * POST /api/content/buy/strip-v
 * One-time maintenance: remove CloudFront `v=` cache-buster from stored buy content images.
 *
 * This is safe because `v=` is not required for these images and can break some CloudFront setups.
 * Auth is required in normal environments. In local dev, allow localhost calls without auth.
 */
router.post('/buy/strip-v', async (req, res) => {
  try {
    const isDev = (process.env.NODE_ENV || '').toLowerCase() === 'development';
    const ip = String(req.ip || '');
    const isLocal =
      ip.includes('127.0.0.1') ||
      ip.includes('::1') ||
      ip.includes('::ffff:127.0.0.1');
    if (!(isDev && isLocal)) {
      // Require auth outside local dev loopback
      return authMiddleware(req, res, async () => {
        const db = getDB();
        const doc = await db.collection('content').findOne({ key: CONTENT_KEY_BUY });
        const current = (doc && doc.value) || {};
        const before = JSON.stringify(current || {});
        stripVFromBuyContentImages(current);
        const after = JSON.stringify(current || {});
        const changed = before !== after;
        if (changed) {
          await db.collection('content').updateOne(
            { key: CONTENT_KEY_BUY },
            { $set: { key: CONTENT_KEY_BUY, value: current, updatedAt: new Date() } },
            { upsert: true }
          );
        }
        res.json({ success: true, changed });
      });
    }

    const db = getDB();
    const doc = await db.collection('content').findOne({ key: CONTENT_KEY_BUY });
    const current = (doc && doc.value) || {};
    const before = JSON.stringify(current || {});
    stripVFromBuyContentImages(current);
    const after = JSON.stringify(current || {});
    const changed = before !== after;
    if (changed) {
      await db.collection('content').updateOne(
        { key: CONTENT_KEY_BUY },
        { $set: { key: CONTENT_KEY_BUY, value: current, updatedAt: new Date() } },
        { upsert: true }
      );
    }
    res.json({ success: true, changed });
  } catch (err) {
    console.error('POST /content/buy/strip-v error:', err);
    res.status(500).json({ error: 'Failed to strip v from buy content' });
  }
});

/**
 * PATCH /api/content/buy
 * Update Buy module content (partial). Auth required (dashboard).
 * Body: any subset of the GET response; nested objects are merged.
 */
router.patch('/buy', authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const db = getDB();
    const doc = await db.collection('content').findOne({ key: CONTENT_KEY_BUY });
    const current = (doc && doc.value) || {};
    const merged = deepMerge(current, body);
    // Ensure dashboard/import does NOT persist CloudFront `v=` cache-busters.
    // Some CloudFront distributions reject unknown params; app images must work with exact master sheet URLs.
    stripVFromBuyContentImages(merged);
    const now = new Date();
    await db.collection('content').updateOne(
      { key: CONTENT_KEY_BUY },
      { $set: { key: CONTENT_KEY_BUY, value: merged, updatedAt: now } },
      { upsert: true }
    );
    const updated = await db.collection('content').findOne({ key: CONTENT_KEY_BUY });
    const out = deepMerge(BUY_CONTENT_DEFAULTS, updated.value || {});
    normalizeBuyContentLegacyCriticalSubImages(out);
    await freshenBuyContentImageUrls(out);
    out.contentVersion = String(now.getTime());
    res.json(out);
  } catch (err) {
    console.error('PATCH /content/buy error:', err);
    res.status(500).json({ error: 'Failed to update buy content' });
  }
});

/**
 * POST /api/content/buy/buyer-categories
 * Append a new institutional buyer category (e.g. when app user selects "Others" and adds custom).
 * Public so the app can call. Adds to quantityStep.buyerCategoryOptions and persists; dashboard dropdown uses same list.
 * Body: { buyerCategory: string }
 */
router.post('/buy/buyer-categories', async (req, res) => {
  try {
    const label = req.body && typeof req.body.buyerCategory === 'string' ? req.body.buyerCategory.trim() : '';
    if (!label) {
      return res.status(400).json({ error: 'buyerCategory is required' });
    }
    const db = getDB();
    const doc = await db.collection('content').findOne({ key: CONTENT_KEY_BUY });
    const current = (doc && doc.value) || {};
    const defaults = BUY_CONTENT_DEFAULTS.quantityStep.buyerCategoryOptions || [];
    const currentList = Array.isArray(current.quantityStep?.buyerCategoryOptions) && current.quantityStep.buyerCategoryOptions.length > 0
      ? current.quantityStep.buyerCategoryOptions
      : defaults;
    if (currentList.map((c) => String(c).trim().toLowerCase()).includes(label.toLowerCase())) {
      const merged = deepMerge(BUY_CONTENT_DEFAULTS, { ...current, quantityStep: { ...current.quantityStep, buyerCategoryOptions: currentList } });
      normalizeBuyContentLegacyCriticalSubImages(merged);
      await freshenBuyContentImageUrls(merged);
      return res.json(merged);
    }
    const nextList = [...currentList, label];
    const merged = { ...current, quantityStep: { ...(current.quantityStep || {}), buyerCategoryOptions: nextList } };
    await db.collection('content').updateOne(
      { key: CONTENT_KEY_BUY },
      { $set: { key: CONTENT_KEY_BUY, value: merged, updatedAt: new Date() } },
      { upsert: true }
    );
    const updated = await db.collection('content').findOne({ key: CONTENT_KEY_BUY });
    const out = deepMerge(BUY_CONTENT_DEFAULTS, updated.value || {});
    normalizeBuyContentLegacyCriticalSubImages(out);
    await freshenBuyContentImageUrls(out);
    res.json(out);
  } catch (err) {
    console.error('POST /content/buy/buyer-categories error:', err);
    res.status(500).json({ error: 'Failed to add buyer category' });
  }
});

/**
 * GET /api/content/sell
 * Returns Sell module content (text, options). Public. App and dashboard use for realtime copy.
 */
router.get('/sell', async (req, res) => {
  try {
    const db = getDB();
    const doc = await db.collection('content').findOne({ key: CONTENT_KEY_SELL });
    const stored = (doc && doc.value) || {};
    const merged = deepMerge(SELL_CONTENT_DEFAULTS, stored);
    merged.saleConfirmed = normalizeSaleConfirmedMerged(merged.saleConfirmed);
    res.json(merged);
  } catch (err) {
    console.error('GET /content/sell error:', err);
    res.status(500).json({ error: 'Failed to fetch sell content' });
  }
});

/**
 * GET /api/content/banners
 * Returns banners for app display. Public. Query: ?targetPage=splash|onboarding|onboarding_1|onboarding_2|onboarding_3|home|homepage|buy|sell|artisanal
 * Dashboard manages via /api/dashboard/content/banners; app fetches here.
 * When targetPage=onboarding, returns banners for onboarding_1, onboarding_2, onboarding_3 so app can show 3 slides.
 */
router.get('/banners', async (req, res) => {
  try {
    const db = getDB();
    const bannerVersion = await getBannerCacheVersion(db);
    const filter = { active: true };
    const targetPage = req.query.targetPage;
    if (targetPage === 'onboarding') {
      filter.targetPage = { $in: ['onboarding', 'onboarding_1', 'onboarding_2', 'onboarding_3'] };
    } else if (targetPage === 'home' || targetPage === 'homepage') {
      filter.targetPage = { $in: ['home', 'homepage'] };
    } else if (targetPage) {
      filter.targetPage = targetPage;
    }
    const list = await db.collection('banners').find(filter).sort({ position: 1, createdAt: -1 }).toArray();
    const out = await Promise.all(list.map(async (b) => {
      let imageUrl = b.imageUrl || '';
      if (b.imageKey) {
        try {
          imageUrl = await getCachedBannerImageUrl(b.imageKey, imageUrl);
        } catch (e) {
          console.warn('Content banners presign error:', e.message);
        }
      }
      return {
        id: b._id?.toString(),
        title: b.title,
        subtitle: b.subtitle || b.description || '',
        buttonText: b.buttonText || '',
        sponsoredTag: b.sponsoredTag || '',
        description: b.description || b.subtitle || '',
        imageUrl,
        targetPage: b.targetPage || 'homepage',
        linkUrl: b.linkUrl || '',
        position: b.position || 0,
        fitMode: b.fitMode === 'contain' ? 'contain' : 'cover',
        offsetX: Number.isFinite(Number(b.offsetX)) ? Number(b.offsetX) : 0,
        offsetY: Number.isFinite(Number(b.offsetY)) ? Number(b.offsetY) : 0,
        zoom: Number.isFinite(Number(b.zoom)) ? Number(b.zoom) : 1,
      };
    }));
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.setHeader('x-banner-version', bannerVersion);
    res.json(out);
  } catch (err) {
    console.error('GET /content/banners error:', err);
    res.status(500).json({ error: 'Failed to fetch banners' });
  }
});

router.get('/banners/version', async (req, res) => {
  try {
    const db = getDB();
    const version = await getBannerCacheVersion(db);
    res.setHeader('Cache-Control', 'public, max-age=10, stale-while-revalidate=30');
    res.json({ version });
  } catch (err) {
    console.error('GET /content/banners/version error:', err);
    res.status(500).json({ error: 'Failed to fetch banner version' });
  }
});

/**
 * GET /api/content/videos
 * Returns training videos for app (e.g. Artisanal miners page). Public.
 * Dashboard manages via /api/dashboard/content/videos; app fetches here.
 */
router.get('/videos', async (req, res) => {
  try {
    const db = getDB();
    const list = await db.collection('training_videos').find({}).sort({ createdAt: -1 }).toArray();
    res.json(list.map((v) => ({
      id: v._id?.toString(),
      title: v.title || '',
      url: v.url || '',
      description: v.description || '',
      category: v.category || 'general',
      duration: v.duration || '',
      xpReward: v.xpReward || '',
      chapters: Array.isArray(v.chapters) ? v.chapters : [],
    })));
  } catch (err) {
    console.error('GET /content/videos error:', err);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

/**
 * GET /api/content/recent-activity
 * Returns dashboard-managed recent activity for app Home screen. Public.
 * Dashboard manages via /api/dashboard/content/recent-activity; app fetches here.
 */
router.get('/recent-activity', async (req, res) => {
  try {
    const db = getDB();
    const list = await db.collection('recent_activity').find({}).sort({ createdAt: -1 }).limit(20).toArray();
    res.json(list.map((a) => ({
      id: a._id?.toString(),
      title: a.title,
      body: a.body || '',
      type: a.type || 'info',
      createdAt: a.createdAt,
    })));
  } catch (err) {
    console.error('GET /content/recent-activity error:', err);
    res.status(500).json({ error: 'Failed to fetch recent activity' });
  }
});

/**
 * PATCH /api/content/sell
 * Update Sell module content (partial). Auth required (dashboard).
 */
router.patch('/sell', authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const db = getDB();
    const doc = await db.collection('content').findOne({ key: CONTENT_KEY_SELL });
    const current = (doc && doc.value) || {};
    const merged = deepMerge(current, body);
    await db.collection('content').updateOne(
      { key: CONTENT_KEY_SELL },
      { $set: { key: CONTENT_KEY_SELL, value: merged, updatedAt: new Date() } },
      { upsert: true }
    );
    const updated = await db.collection('content').findOne({ key: CONTENT_KEY_SELL });
    const out = deepMerge(SELL_CONTENT_DEFAULTS, updated.value || {});
    out.saleConfirmed = normalizeSaleConfirmedMerged(out.saleConfirmed);
    res.json(out);
  } catch (err) {
    console.error('PATCH /content/sell error:', err);
    res.status(500).json({ error: 'Failed to update sell content' });
  }
});

/**
 * GET /api/content/legal
 * Public. Returns Terms of Service and Privacy Policy for app (e.g. login screen).
 * Content is set by admin in dashboard (Content & Marketing → Terms & Privacy).
 */
const LEGAL_KEY = 'legal';
router.get('/legal', async (req, res) => {
  try {
    const db = getDB();
    const doc = await db.collection('content').findOne({ key: LEGAL_KEY });
    const value = (doc && doc.value) || {};
    res.json({
      termsOfService: value.termsOfService != null ? String(value.termsOfService) : '',
      privacyPolicy: value.privacyPolicy != null ? String(value.privacyPolicy) : '',
    });
  } catch (err) {
    console.error('GET /content/legal error:', err);
    res.status(500).json({ error: 'Failed to fetch legal content' });
  }
});

module.exports = router;
