/**
 * Account deletion requests — MongoDB `account_deletions` for dashboard & mobile app.
 */

const { ObjectId } = require('mongodb');

const VALID_STATUSES = ['pending', 'approved', 'rejected', 'completed'];

function serializeAccountDeletion(d) {
  if (!d) return null;
  const rawUid = d.userId;
  const userIdNorm = rawUid != null ? String(rawUid) : undefined;
  return {
    id: d._id.toString(),
    userId: userIdNorm,
    userName: d.userName,
    userEmail: d.userEmail,
    userPhone: d.userPhone,
    status: d.status || 'pending',
    reason: d.reason,
    type: d.type || 'user_requested',
    requestedAt: d.requestedAt,
    createdAt: d.createdAt ?? d.requestedAt,
    updatedAt: d.updatedAt,
    reviewedAt: d.reviewedAt,
    reviewedBy: d.reviewedBy != null ? String(d.reviewedBy) : undefined,
    reviewedByName: d.reviewedByName,
    deletedAt: d.deletedAt,
    deletedBy: d.deletedBy != null ? String(d.deletedBy) : undefined,
    deletedByName: d.deletedByName,
  };
}

async function listAccountDeletions(db, { status, limit = 100 } = {}) {
  const filter = {};
  if (status && status !== 'all') filter.status = status;
  const cap = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const list = await db
    .collection('account_deletions')
    .find(filter)
    .sort({ createdAt: -1, requestedAt: -1 })
    .limit(cap)
    .toArray();
  return list.map(serializeAccountDeletion);
}

async function getAccountDeletionMetrics(db) {
  const [all, pending, approved, rejected, completed] = await Promise.all([
    db.collection('account_deletions').countDocuments({}),
    db.collection('account_deletions').countDocuments({ status: 'pending' }),
    db.collection('account_deletions').countDocuments({ status: 'approved' }),
    db.collection('account_deletions').countDocuments({ status: 'rejected' }),
    db.collection('account_deletions').countDocuments({ status: 'completed' }),
  ]);
  return { all, pending, approved, rejected, completed };
}

async function updateAccountDeletionStatus(db, id, { status, reviewedBy, reviewedByName, note }) {
  if (!ObjectId.isValid(id)) {
    const err = new Error('Invalid deletion request id');
    err.status = 400;
    throw err;
  }
  const normalized = String(status || '').toLowerCase();
  if (!VALID_STATUSES.includes(normalized)) {
    const err = new Error(`status must be one of: ${VALID_STATUSES.join(', ')}`);
    err.status = 400;
    throw err;
  }
  const now = new Date();
  const $set = {
    status: normalized,
    updatedAt: now,
    reviewedAt: now,
  };
  if (reviewedBy) $set.reviewedBy = String(reviewedBy);
  if (reviewedByName) $set.reviewedByName = reviewedByName;
  if (note != null && String(note).trim()) $set.reviewNote = String(note).trim();

  const oid = new ObjectId(id);
  const doc = await db.collection('account_deletions').findOneAndUpdate(
    { _id: oid },
    { $set },
    { returnDocument: 'after' },
  );
  if (!doc) {
    const err = new Error('Deletion request not found');
    err.status = 404;
    throw err;
  }
  const userId = doc.userId != null ? String(doc.userId) : null;
  if (userId && (normalized === 'approved' || normalized === 'rejected')) {
    try {
      const profileUpdate =
        normalized === 'approved'
          ? { accountStatus: 'pending_deletion', updatedAt: now }
          : { accountStatus: 'active', updatedAt: now };
      await db.collection('profiles').updateOne({ userId }, { $set: profileUpdate });
    } catch (e) {
      console.warn('account_deletions: profile status update failed:', e.message);
    }
  }

  return serializeAccountDeletion(doc);
}

async function writeAccountDeletionAudit(db, { action, details, actor, actorId, targetId }) {
  try {
    await db.collection('audit_log').insertOne({
      action,
      type: 'account_deletion',
      details: details || '',
      actor: actor || 'Admin',
      actorId,
      targetType: 'account_deletion',
      targetId,
      createdAt: new Date(),
    });
  } catch (e) {
    console.warn('account_deletions audit_log write failed:', e.message);
  }
}

module.exports = {
  VALID_STATUSES,
  serializeAccountDeletion,
  listAccountDeletions,
  getAccountDeletionMetrics,
  updateAccountDeletionStatus,
  writeAccountDeletionAudit,
};
