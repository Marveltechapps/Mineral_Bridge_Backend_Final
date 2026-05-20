require('dotenv').config();
const { connectDB, getDB } = require('../config/db');

const CONTENT_KEY_BUY = 'buy';

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
  if (!obj || typeof obj !== 'object') return { changed: 0 };
  let changed = 0;
  const maybeSet = (container, key) => {
    const cur = container[key];
    const next = stripCloudfrontVParam(cur);
    if (typeof cur === 'string' && typeof next === 'string' && cur !== next) {
      container[key] = next;
      changed += 1;
    }
  };

  if (obj.buyCategoryImages && typeof obj.buyCategoryImages === 'object') {
    for (const k of Object.keys(obj.buyCategoryImages)) maybeSet(obj.buyCategoryImages, k);
  }
  if (obj.buySubCategoryImages && typeof obj.buySubCategoryImages === 'object') {
    for (const g of Object.keys(obj.buySubCategoryImages)) {
      const group = obj.buySubCategoryImages[g];
      if (!group || typeof group !== 'object') continue;
      for (const k of Object.keys(group)) maybeSet(group, k);
    }
  }
  if (typeof obj.bannerImageUrl === 'string') {
    const before = obj.bannerImageUrl;
    const after = stripCloudfrontVParam(before);
    if (before !== after) {
      obj.bannerImageUrl = after;
      changed += 1;
    }
  }
  if (obj.categoryDisplay && typeof obj.categoryDisplay === 'object') {
    for (const k of Object.keys(obj.categoryDisplay)) {
      const item = obj.categoryDisplay[k];
      if (item && typeof item === 'object' && typeof item.imageUrl === 'string') {
        const before = item.imageUrl;
        const after = stripCloudfrontVParam(before);
        if (before !== after) {
          item.imageUrl = after;
          changed += 1;
        }
      }
    }
  }
  return { changed };
}

async function main() {
  await connectDB();
  const db = getDB();
  const col = db.collection('content');
  const doc = await col.findOne({ key: CONTENT_KEY_BUY });
  if (!doc || !doc.value || typeof doc.value !== 'object') {
    console.log('No buy content found to clean.');
    process.exit(0);
  }
  const value = doc.value;
  const { changed } = stripVFromBuyContentImages(value);
  if (!changed) {
    console.log('Buy content: no CloudFront v= params found.');
    process.exit(0);
  }
  await col.updateOne(
    { key: CONTENT_KEY_BUY },
    { $set: { value, updatedAt: new Date() } }
  );
  console.log(`Buy content: removed v= from ${changed} URL(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error('strip-v-from-buy-content failed:', err);
  process.exit(1);
});

