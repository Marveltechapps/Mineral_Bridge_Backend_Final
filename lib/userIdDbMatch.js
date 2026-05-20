const { ObjectId } = require('mongodb');

/**
 * Match notifications (and similar docs) where userId may be stored as string or ObjectId.
 */
function userIdDbMatch(uid) {
  const s = String(uid);
  if (ObjectId.isValid(s)) {
    return { $or: [{ userId: s }, { userId: new ObjectId(s) }] };
  }
  return { userId: s };
}

module.exports = { userIdDbMatch };
