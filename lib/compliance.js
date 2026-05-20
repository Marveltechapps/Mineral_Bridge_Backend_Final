/**
 * Compliance & Verification — KYC aggregations for dashboard.
 */

const { ObjectId } = require('mongodb');

const STATUS_PRIORITY = {
  rejected: 5,
  flagged: 4,
  under_review: 3,
  pending: 3,
  draft: 2,
  approved: 1,
};

function mapDisplayStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'approved') return 'Approved';
  if (s === 'rejected') return 'Rejected';
  if (s === 'flagged') return 'Flagged';
  if (s === 'under_review') return 'Under Review';
  if (s === 'draft') return 'Draft';
  if (s === 'pending') return 'Pending';
  return 'Pending';
}

function pickDominantStatus(statuses) {
  let best = 'pending';
  let bestPri = 0;
  for (const raw of statuses) {
    const s = String(raw || 'pending').toLowerCase();
    const pri = STATUS_PRIORITY[s] ?? 2;
    if (pri > bestPri) {
      bestPri = pri;
      best = s;
    }
  }
  return best;
}

function computeDocScore(docs, displayStatus) {
  let score = 40;
  for (const d of docs) {
    const parts = [d.frontKey || d.frontUrl, d.backKey || d.backUrl, d.selfieKey || d.selfieUrl].filter(Boolean);
    score += Math.min(parts.length * 15, 45);
  }
  const s = String(displayStatus).toLowerCase();
  if (s === 'approved') score = Math.max(score, 92);
  else if (s === 'under review' || s === 'under_review') score = Math.max(score, 72);
  else if (s === 'rejected' || s === 'flagged') score = Math.min(score, 55);
  return Math.min(99, Math.max(35, score));
}

function formatRelativeTime(date) {
  if (!date) return '—';
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function resolveCountryName(user) {
  if (!user) return '—';
  return user.country || user.countryName || user.countryCode || '—';
}

function kycTypeLabel(profile) {
  if (!profile?.kycType) return 'Individual';
  const t = String(profile.kycType).toLowerCase();
  if (t === 'business') return 'Business';
  if (t === 'miner') return 'Miner';
  return 'Individual';
}

function avatarFromName(name) {
  return String(name || '?')
    .split(/\s+/)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '—';
}

async function buildVerifications(db, limit = 100) {
  const kycList = await db.collection('kyc_documents').find({}).sort({ updatedAt: -1, createdAt: -1 }).limit(500).toArray();

  const byUser = new Map();
  for (const k of kycList) {
    const uid = k.userId ? String(k.userId) : null;
    if (!uid) continue;
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push(k);
  }

  const userIds = [...byUser.keys()];
  const validIds = userIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const users = validIds.length ? await db.collection('users').find({ _id: { $in: validIds } }).toArray() : [];
  const userMap = {};
  users.forEach((u) => {
    userMap[u._id.toString()] = u;
  });

  const profiles = userIds.length
    ? await db.collection('profiles').find({ userId: { $in: userIds } }).toArray()
    : [];
  const profileMap = {};
  profiles.forEach((p) => {
    profileMap[String(p.userId)] = p;
  });

  const verifications = [];
  for (const [userId, docs] of byUser) {
    const user = userMap[userId];
    const profile = profileMap[userId];
    const name = user ? user.name || user.email || user.phone || 'Unknown' : 'Unknown';
    const rawStatuses = docs.map((d) => d.status);
    if (profile?.kycStatus) rawStatuses.push(profile.kycStatus);
    const dominant = pickDominantStatus(rawStatuses);
    const displayStatus = mapDisplayStatus(dominant);
    const latest = docs.reduce((a, b) => {
      const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return tb > ta ? b : a;
    }, docs[0]);

    const completeDocs = docs.filter((d) => {
      const hasFront = !!(d.frontKey || d.frontUrl);
      const hasBack = !!(d.backKey || d.backUrl);
      const hasSelfie = !!(d.selfieKey || d.selfieUrl);
      return hasFront && hasBack && hasSelfie;
    }).length;

    const issues = [];
    if (displayStatus === 'Rejected') issues.push('Document rejected');
    if (displayStatus === 'Flagged') issues.push('KYC flagged for review');
    if (displayStatus === 'Under Review' && completeDocs < docs.length) issues.push('Incomplete document set');

    verifications.push({
      id: latest._id.toString(),
      userId,
      name,
      type: kycTypeLabel(profile),
      status: displayStatus,
      score: computeDocScore(docs, displayStatus),
      country: (user && user.countryCode) || '—',
      countryName: resolveCountryName(user),
      docs: completeDocs,
      totalDocs: docs.length,
      issues,
      updated: formatRelativeTime(latest.updatedAt || latest.createdAt),
      avatar: avatarFromName(name),
    });
  }

  verifications.sort((a, b) => {
    const pri = (s) => STATUS_PRIORITY[String(s).toLowerCase().replace(/\s+/g, '_')] ?? 2;
    return pri(b.status) - pri(a.status);
  });

  return verifications.slice(0, limit);
}

async function buildAlerts(db, limit = 20) {
  const kycRejected = await db
    .collection('kyc_documents')
    .find({ status: { $in: ['rejected', 'flagged', 'under_review'] } })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray();

  const userIds = [...new Set(kycRejected.map((k) => k.userId).filter((id) => id && ObjectId.isValid(String(id))))];
  const userObjIds = userIds.map((id) => new ObjectId(id));
  const users = userObjIds.length ? await db.collection('users').find({ _id: { $in: userObjIds } }).toArray() : [];
  const userMap = {};
  users.forEach((u) => {
    userMap[u._id.toString()] = u;
  });

  return kycRejected.map((k) => {
    const user = userMap[String(k.userId)];
    const entity = user ? user.name || user.email || user.phone || 'Unknown' : 'Unknown';
    const statusRaw = String(k.status || '').toLowerCase();
    let issue = 'KYC requires review';
    if (statusRaw === 'rejected') issue = 'Document rejected';
    else if (statusRaw === 'flagged') issue = 'KYC flagged for review';
    else if (statusRaw === 'under_review') issue = 'KYC submission awaiting review';

    return {
      id: k._id.toString(),
      entity,
      issue,
      status: statusRaw === 'rejected' ? 'Closed' : 'Open',
      admin: '—',
    };
  });
}

async function buildMetrics(db) {
  const [pending, approved, rejected, flagged, underReview] = await Promise.all([
    db.collection('kyc_documents').countDocuments({ status: { $in: ['pending', 'draft'] } }),
    db.collection('kyc_documents').countDocuments({ status: 'approved' }),
    db.collection('kyc_documents').countDocuments({ status: 'rejected' }),
    db.collection('kyc_documents').countDocuments({ status: 'flagged' }),
    db.collection('kyc_documents').countDocuments({ status: 'under_review' }),
  ]);

  const pieData = [
    { name: 'Approved', value: approved, color: '#10b981' },
    { name: 'Under Review', value: underReview, color: '#f59e0b' },
    { name: 'Pending', value: pending, color: '#94a3b8' },
    { name: 'Flagged', value: flagged, color: '#f43f5e' },
    { name: 'Rejected', value: rejected, color: '#64748b' },
  ].filter((p) => p.value > 0);

  return {
    pieData,
    trendData: [],
    pendingKyc: pending + underReview,
    complianceIssues: flagged + rejected,
    avgVerificationTime: 0,
  };
}

async function writeComplianceAudit(db, { action, details, actor, actorId, targetId }) {
  try {
    await db.collection('audit_log').insertOne({
      action,
      type: 'compliance',
      details: details || '',
      actor: actor || 'Admin',
      actorId,
      targetType: 'kyc',
      targetId,
      createdAt: new Date(),
    });
  } catch (e) {
    console.warn('compliance audit_log write failed:', e.message);
  }
}

module.exports = {
  mapDisplayStatus,
  buildVerifications,
  buildAlerts,
  buildMetrics,
  writeComplianceAudit,
};
