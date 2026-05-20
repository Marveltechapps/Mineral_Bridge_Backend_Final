/**
 * Effective confirmed total string for API responses (DB field or saved orderSummary.total).
 */
function resolveConfirmedPriceForApi(order) {
  if (!order || typeof order !== 'object') return null;
  const c = order.confirmedPrice;
  if (c != null && String(c).trim() !== '') return String(c).trim();
  const os = order.orderSummary;
  if (os && typeof os === 'object' && os.total != null) {
    const t = String(os.total).trim();
    if (t) return t;
  }
  return null;
}

module.exports = { resolveConfirmedPriceForApi };
