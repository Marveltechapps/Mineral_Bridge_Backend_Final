/** Map dashboard UI status ↔ MongoDB callbacks.status */

function normalizeCallbackStatus(status) {
  const s = String(status || '')
    .trim()
    .toLowerCase();
  if (s === 'resolved' || s === 'completed') return 'completed';
  if (s === 'in progress' || s === 'in_progress' || s === 'acknowledged') return 'acknowledged';
  if (s === 'open' || s === 'pending') return 'pending';
  return String(status || 'pending').trim() || 'pending';
}

function callbackStatusToUi(dbStatus) {
  const s = String(dbStatus || '')
    .trim()
    .toLowerCase();
  if (s === 'completed') return 'Resolved';
  if (s === 'acknowledged') return 'In Progress';
  return 'Open';
}

function formatCallbackDate(createdAt) {
  if (!createdAt) return '—';
  try {
    return new Date(createdAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function mapCallbackForDashboard(cb) {
  const id = cb._id ? cb._id.toString() : String(cb.id || '');
  const orderLabel = cb.orderLabel || cb.reason || '';
  const isHelp = String(cb.orderId || '') === 'help-support';
  return {
    id,
    userId: cb.userId != null ? String(cb.userId) : undefined,
    userPhone: cb.userPhone || '',
    userEmail: cb.userEmail || '',
    userName: cb.userName || '',
    orderId: cb.orderId != null ? String(cb.orderId) : '',
    orderLabel,
    callHistoryId: cb.callHistoryId ? String(cb.callHistoryId) : undefined,
    subject: isHelp
      ? 'Help & Support callback'
      : orderLabel
        ? `Callback — ${orderLabel}`
        : 'Callback request',
    preview:
      (Array.isArray(cb.replies) && cb.replies.length > 0
        ? cb.replies[cb.replies.length - 1].text
        : null) ||
      cb.notes ||
      (isHelp ? 'User requested priority callback from Help & Support.' : 'User requested a callback from the app.'),
    status: callbackStatusToUi(cb.status),
    dbStatus: cb.status || 'pending',
    priority: 'High',
    time: formatCallbackDate(cb.createdAt),
    createdAt: cb.createdAt,
    type: 'Callback',
    replies: Array.isArray(cb.replies) ? cb.replies : [],
  };
}

function mapSupportRequestForDashboard(sr) {
  const id = sr._id ? sr._id.toString() : String(sr.id || '');
  const typeRaw = String(sr.type || 'email').toLowerCase();
  return {
    id,
    userId: sr.userId != null ? String(sr.userId) : undefined,
    orderId: sr.orderId != null ? String(sr.orderId) : '',
    subject: sr.subject || sr.category || 'Support request',
    preview: sr.message || sr.subject || 'Support message from app',
    status: String(sr.status || '').toLowerCase() === 'closed' ? 'Resolved' : 'Open',
    priority: 'Medium',
    time: formatCallbackDate(sr.createdAt),
    createdAt: sr.createdAt,
    type: typeRaw === 'email' ? 'Email' : typeRaw === 'chat' ? 'Chat' : 'Support',
    replies: Array.isArray(sr.replies) ? sr.replies : [],
  };
}

module.exports = {
  normalizeCallbackStatus,
  callbackStatusToUi,
  mapCallbackForDashboard,
  mapSupportRequestForDashboard,
};
