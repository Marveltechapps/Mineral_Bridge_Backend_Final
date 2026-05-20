/**
 * Financial & Reporting aggregations from MongoDB (orders, transactions).
 */

const { parseAmount } = require('./transactions');

function parseRecordDate(input) {
  if (input == null) return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function orderRecordDate(order) {
  return parseRecordDate(order.createdAt) ?? parseRecordDate(order.updatedAt);
}

function transactionRecordDate(tx) {
  return parseRecordDate(tx.createdAt) ?? parseRecordDate(tx.date);
}

function isDateInRange(date, rangeKey) {
  if (!rangeKey || rangeKey === 'all') return true;
  if (!date) return false;

  const y = date.getFullYear();
  const m = date.getMonth();
  const now = new Date();

  if (rangeKey.startsWith('ytd:')) {
    const ty = Number(rangeKey.slice(4));
    return ty && y === ty && date <= now;
  }
  if (rangeKey.startsWith('year:')) {
    const ty = Number(rangeKey.slice(5));
    return !ty || y === ty;
  }
  if (rangeKey.startsWith('month:')) {
    const ym = rangeKey.slice(6);
    const [ys, ms] = ym.split('-');
    const ty = Number(ys);
    const mo = Number(ms);
    return ty && mo && y === ty && m === mo - 1;
  }
  if (rangeKey === 'jan2026') return y === 2026 && m === 0;
  if (rangeKey === 'feb2026') return y === 2026 && m === 1;
  if (rangeKey === 'ytd') return y === now.getFullYear() && date <= now;
  return true;
}

function isBuyOrder(order) {
  return String(order.type || '').toLowerCase() !== 'sell';
}

function isCompletedOrder(order) {
  const s = String(order.status || '').trim();
  return s === 'Completed' || s === 'Order Completed';
}

function buyRevenueFromOrder(order) {
  if (order.orderSummary && order.orderSummary.total != null) {
    return parseAmount(order.orderSummary.total);
  }
  return parseAmount(order.totalDue) || parseAmount(order.confirmedPrice) || parseAmount(order.amount);
}

async function computeRevenueBreakdown(db) {
  const [transactions, orders] = await Promise.all([
    db.collection('transactions').find({ status: 'Completed' }).toArray(),
    db.collection('orders').find({}).toArray(),
  ]);

  let platformFees = 0;
  for (const tx of transactions) {
    platformFees += parseAmount(tx.serviceFee) || parseAmount(tx.serviceFeeAmount);
  }

  let testingFees = 0;
  let logisticsFees = 0;
  for (const o of orders) {
    testingFees += parseAmount(o.testingFee);
    logisticsFees += parseAmount(o.transportFee) || parseAmount(o.transportCost);
  }

  return {
    platformFees: Math.round(platformFees * 100) / 100,
    testingFees: Math.round(testingFees * 100) / 100,
    logisticsFees: Math.round(logisticsFees * 100) / 100,
    bankCharges: 0,
  };
}

async function computeFinancialSummary(db, rangeKey = 'all') {
  const [orders, transactions] = await Promise.all([
    db.collection('orders').find({}).toArray(),
    db.collection('transactions').find({}).toArray(),
  ]);

  const orderDateMap = new Map();
  for (const o of orders) {
    const d = orderRecordDate(o);
    if (d) orderDateMap.set(String(o._id), d);
  }

  const orderInRange = (o) => isDateInRange(orderRecordDate(o), rangeKey);
  const txInRange = (tx) => {
    const d = transactionRecordDate(tx) ?? orderDateMap.get(String(tx.orderId));
    return isDateInRange(d, rangeKey);
  };

  const ordersFiltered = orders.filter(orderInRange);
  const txFiltered = transactions.filter(txInRange);

  const buyOrders = ordersFiltered.filter(isBuyOrder);
  const sellOrders = ordersFiltered.filter((o) => !isBuyOrder(o));

  const completedBuy = buyOrders.filter(isCompletedOrder);
  let totalBuyRevenue = 0;
  for (const o of completedBuy) {
    totalBuyRevenue += buyRevenueFromOrder(o);
  }

  const pendingPaymentBuy = buyOrders.filter((o) => {
    if (String(o.status || '') === 'Cancelled') return false;
    if (isCompletedOrder(o)) return false;
    const steps = Array.isArray(o.flowSteps) ? o.flowSteps : [];
    const paymentDone = steps.find((s) => s && s.label === 'Payment Received' && s.completed);
    return !paymentDone;
  });

  const sellPaymentReleased = sellOrders.filter(
    (o) => o.mineralCollected === true || o.paymentReleasedAt
  );
  const sellCompleted = sellOrders.filter(
    (o) => String(o.status || '') === 'Order Completed' || o.currentStep === 6
  );

  const failedTx = txFiltered.filter((t) => t.status === 'Failed');

  return {
    range: rangeKey,
    buy: {
      totalRevenue: Math.round(totalBuyRevenue * 100) / 100,
      pendingPayment: pendingPaymentBuy.length,
      completed: completedBuy.length,
    },
    sell: {
      totalOrders: sellOrders.length,
      paymentReleased: sellPaymentReleased.length,
      completed: sellCompleted.length,
    },
    transactions: {
      total: txFiltered.length,
      failed: failedTx.length,
      completed: txFiltered.filter((t) => t.status === 'Completed').length,
    },
  };
}

module.exports = {
  isDateInRange,
  computeRevenueBreakdown,
  computeFinancialSummary,
};
