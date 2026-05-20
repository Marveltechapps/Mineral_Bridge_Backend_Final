/**
 * In-app inbox rows for mobile users (`notifications` collection).
 */

async function insertUserInboxNotification(db, userId, { title, body, data }) {
  const uid = String(userId);
  const doc = {
    userId: uid,
    title: String(title || 'Mineral Bridge'),
    body: body != null ? String(body) : '',
    createdAt: new Date(),
    ...(data && typeof data === 'object' && !Array.isArray(data) ? { data } : {}),
  };
  const result = await db.collection('notifications').insertOne(doc);
  return result.insertedId.toString();
}

module.exports = { insertUserInboxNotification };
