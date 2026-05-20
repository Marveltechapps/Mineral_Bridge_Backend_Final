/**
 * Canonical transaction shape for dashboard settlements + legacy app fields.
 */
const { ObjectId } = require('mongodb');

function parseAmount(value) {
  if (value == null) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function formatUsd(amount) {
  const n = parseAmount(amount);
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function orderTypeFromOrder(order) {
  const t = String(order?.type || order?.orderType || '').toLowerCase();
  return t === 'sell' ? 'Sell' : 'Buy';
}

function amountFromOrder(order) {
  return (
    parseAmount(order?.totalDue) ||
    parseAmount(order?.amount) ||
    parseAmount(order?.subtotal) ||
    parseAmount(order?.estimatedPayout)
  );
}

/**
 * Build a transaction document when an order is created (app or dashboard).
 */
function buildTransactionFromOrder(order, orderMongoId, overrides = {}) {
  const now = overrides.createdAt || new Date();
  const orderType = orderTypeFromOrder(order);
  const totalNum = amountFromOrder(order);
  const feeNum = parseAmount(order?.transportFee);
  const subtotalNum = parseAmount(order?.subtotal) || Math.max(0, totalNum - feeNum) || totalNum;
  const mineral = String(order?.mineralName || order?.mineral || 'Mineral');
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = now.toTimeString().slice(0, 5);

  const doc = {
    userId: order?.userId != null ? String(order.userId) : undefined,
    orderId: String(orderMongoId),
    type: orderType,
    orderType,
    mineral,
    itemName: mineral,
    aiEstimate: formatUsd(totalNum),
    finalAmount: formatUsd(totalNum),
    serviceFee: formatUsd(feeNum),
    netAmount: formatUsd(Math.max(0, totalNum - feeNum)),
    currency: order?.currency || 'USD',
    method: 'Bank Transfer',
    status: overrides.status || 'Pending',
    date: dateStr,
    time: timeStr,
    subtotal: subtotalNum,
    serviceFeeAmount: feeNum,
    networkFee: 0,
    total: totalNum,
    paymentDetails: {},
    settlementNote: '',
    adminNotes: [],
    createdAt: now,
    updatedAt: now,
  };

  return { ...doc, ...overrides, updatedAt: overrides.updatedAt || now };
}

/**
 * Fields to $set when normalizing legacy transaction documents in MongoDB.
 */
function normalizeTransactionSetFields(tx) {
  const mineral = tx.mineral || tx.itemName || 'Mineral';
  const totalNum =
    parseAmount(tx.total) ||
    parseAmount(tx.finalAmount) ||
    parseAmount(tx.netAmount);
  const feeNum = parseAmount(tx.serviceFeeAmount) || parseAmount(tx.serviceFee);
  const subtotalNum = parseAmount(tx.subtotal) || Math.max(0, totalNum - feeNum) || totalNum;
  const orderType =
    tx.orderType ||
    (tx.type === 'Sell' || tx.type === 'sell' ? 'Sell' : tx.type === 'Buy' || tx.type === 'buy' ? 'Buy' : null) ||
    'Buy';
  const now = new Date();
  const created = tx.createdAt ? new Date(tx.createdAt) : now;
  const dateStr =
    typeof tx.date === 'string' && tx.date.trim()
      ? tx.date
      : created.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr =
    typeof tx.time === 'string' && tx.time.trim()
      ? tx.time
      : created.toTimeString().slice(0, 5);

  const set = { updatedAt: now };
  if (!tx.mineral) set.mineral = mineral;
  if (!tx.itemName) set.itemName = mineral;
  if (!tx.orderType) set.orderType = orderType;
  if (!tx.type) set.type = orderType;
  if (!tx.aiEstimate) set.aiEstimate = formatUsd(totalNum);
  if (!tx.finalAmount) set.finalAmount = formatUsd(totalNum);
  if (tx.serviceFee == null || typeof tx.serviceFee === 'number') set.serviceFee = formatUsd(feeNum);
  if (!tx.netAmount) set.netAmount = formatUsd(Math.max(0, totalNum - feeNum));
  if (!tx.currency) set.currency = 'USD';
  if (!tx.method) set.method = 'Bank Transfer';
  if (typeof tx.date !== 'string') set.date = dateStr;
  if (!tx.time) set.time = timeStr;
  if (tx.subtotal == null) set.subtotal = subtotalNum;
  if (tx.total == null && totalNum) set.total = totalNum;
  if (!tx.paymentDetails) set.paymentDetails = {};
  if (!tx.settlementNote) set.settlementNote = tx.settlementNote || '';
  if (!Array.isArray(tx.adminNotes)) set.adminNotes = [];

  return set;
}

function transactionToDashboardApi(t) {
  const id = t._id ? t._id.toString() : String(t.id || '');
  const mineral = t.mineral || t.itemName || '—';
  const totalNum = parseAmount(t.total) || parseAmount(t.finalAmount);
  const finalAmount =
    typeof t.finalAmount === 'string' && t.finalAmount.trim()
      ? t.finalAmount
      : formatUsd(totalNum);
  return {
    id,
    ...t,
    _id: undefined,
    mineral,
    orderType: t.orderType || (t.type === 'Sell' ? 'Sell' : 'Buy'),
    finalAmount,
    aiEstimate: t.aiEstimate || finalAmount,
    serviceFee:
      typeof t.serviceFee === 'string' ? t.serviceFee : formatUsd(t.serviceFee ?? t.serviceFeeAmount),
    netAmount: t.netAmount || finalAmount,
    currency: t.currency || 'USD',
    method: t.method || 'Bank Transfer',
  };
}

/**
 * Mark order + all linked transactions completed (release settlement).
 */
async function completeSettlementForOrder(db, orderId) {
  if (!orderId) return;
  const now = new Date();
  await db.collection('transactions').updateMany(
    { orderId: String(orderId) },
    { $set: { status: 'Completed', updatedAt: now } }
  );
  if (ObjectId.isValid(String(orderId))) {
    await db.collection('orders').updateOne(
      { _id: new ObjectId(String(orderId)) },
      { $set: { status: 'Completed', updatedAt: now } }
    );
  }
}

/**
 * Mark transaction completed and sync linked order.
 */
async function completeSettlementForTransaction(db, tx) {
  if (!tx) return;
  const now = new Date();
  const orderId = tx.orderId;
  await db.collection('transactions').updateOne(
    { _id: tx._id },
    { $set: { status: 'Completed', updatedAt: now } }
  );
  if (orderId && ObjectId.isValid(String(orderId))) {
    await db.collection('orders').updateOne(
      { _id: new ObjectId(String(orderId)) },
      { $set: { status: 'Completed', updatedAt: now } }
    );
  }
}

module.exports = {
  parseAmount,
  formatUsd,
  buildTransactionFromOrder,
  normalizeTransactionSetFields,
  transactionToDashboardApi,
  completeSettlementForOrder,
  completeSettlementForTransaction,
};
