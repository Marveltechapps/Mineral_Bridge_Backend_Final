/**
 * Analytics aggregations (orders, transactions, users).
 */

const { ObjectId } = require('mongodb');
const { parseAmount } = require('./transactions');

function sinceFromDays(days) {
  const d = parseInt(days, 10);
  if (!d || d <= 0) return null;
  return new Date(Date.now() - d * 86400000);
}

function txAmountExpr() {
  return {
    $max: [
      { $ifNull: ['$total', 0] },
      0,
    ],
  };
}

function transactionDateMatch(since) {
  if (!since) return {};
  return {
    $or: [
      { createdAt: { $gte: since } },
      { date: { $gte: since } },
    ],
  };
}

function orderDateMatch(since) {
  if (!since) return {};
  return { createdAt: { $gte: since } };
}

async function computeOverview(db, days) {
  const since = sinceFromDays(days);
  const txMatch = transactionDateMatch(since);
  const orderMatch = orderDateMatch(since);

  const [users, orders, txCount, volRes] = await Promise.all([
    since
      ? db.collection('users').countDocuments({ createdAt: { $gte: since } })
      : db.collection('users').countDocuments({}),
    db.collection('orders').countDocuments(orderMatch),
    db.collection('transactions').countDocuments(txMatch),
    db
      .collection('transactions')
      .aggregate([
        ...(since ? [{ $match: txMatch }] : []),
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                $cond: [
                  { $gt: [{ $ifNull: ['$total', 0] }, 0] },
                  { $ifNull: ['$total', 0] },
                  0,
                ],
              },
            },
          },
        },
      ])
      .toArray(),
  ]);

  return {
    totalUsers: users,
    totalOrders: orders,
    totalTransactions: txCount,
    tradingVolume: volRes[0]?.total || 0,
    days: days || 0,
  };
}

async function computeTradingVolume(db, days) {
  const d = parseInt(days, 10) || 30;
  const since = sinceFromDays(d);
  const pipeline = [
    { $match: transactionDateMatch(since) },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: { $ifNull: ['$createdAt', '$date'] },
          },
        },
        volume: { $sum: { $ifNull: ['$total', 0] } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ];
  const data = await db.collection('transactions').aggregate(pipeline).toArray();
  return data.map((row) => ({ date: row._id, volume: row.volume || 0, count: row.count || 0 }));
}

async function computeMineralCategories(db, days) {
  const since = sinceFromDays(days);
  const pipeline = [
    ...(since ? [{ $match: orderDateMatch(since) }] : []),
    {
      $group: {
        _id: { $ifNull: ['$mineralName', '$mineral', 'Unknown'] },
        count: { $sum: 1 },
        totalValue: { $sum: { $ifNull: ['$totalDue', '$subtotal', 0] } },
      },
    },
    { $sort: { totalValue: -1 } },
    { $limit: 20 },
  ];
  const data = await db.collection('orders').aggregate(pipeline).toArray();
  return data.map((row) => ({
    mineral: row._id || 'Unknown',
    count: row.count,
    totalValue: row.totalValue || 0,
  }));
}

async function computeTopUsers(db, days, limit = 10) {
  const since = sinceFromDays(days);
  const pipeline = [
    { $match: transactionDateMatch(since) },
    {
      $group: {
        _id: '$userId',
        totalVolume: { $sum: { $ifNull: ['$total', 0] } },
        txCount: { $sum: 1 },
      },
    },
    { $sort: { totalVolume: -1 } },
    { $limit: Math.min(50, limit) },
  ];
  const data = await db.collection('transactions').aggregate(pipeline).toArray();
  const userIds = data.map((row) => row._id).filter((id) => id && ObjectId.isValid(String(id)));
  const users =
    userIds.length > 0
      ? await db
          .collection('users')
          .find({ _id: { $in: userIds.map((id) => new ObjectId(String(id))) } })
          .toArray()
      : [];
  const userMap = {};
  users.forEach((u) => {
    userMap[u._id.toString()] = u;
  });
  return data.map((row) => {
    const u = userMap[String(row._id)] || {};
    const name = u.name || [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || 'Unknown';
    return {
      userId: row._id,
      name,
      email: u.email || '',
      totalVolume: row.totalVolume || 0,
      txCount: row.txCount || 0,
    };
  });
}

async function computeRegional(db, days) {
  const since = sinceFromDays(days);
  if (!since) {
    const pipeline = [
      { $group: { _id: { $ifNull: ['$countryCode', '$country', 'Unknown'] }, userCount: { $sum: 1 } } },
      { $sort: { userCount: -1 } },
      { $limit: 20 },
    ];
    const data = await db.collection('users').aggregate(pipeline).toArray();
    return data.map((row) => ({ region: String(row._id || 'Unknown'), userCount: row.userCount }));
  }

  const orderMatch = orderDateMatch(since);
  const orders = await db.collection('orders').find(orderMatch).project({ userId: 1 }).toArray();
  const userIds = [...new Set(orders.map((o) => String(o.userId)).filter(Boolean))];
  if (userIds.length === 0) return [];

  const users = await db
    .collection('users')
    .find({
      _id: { $in: userIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id)) },
    })
    .toArray();

  const regionCounts = {};
  for (const u of users) {
    const region = u.countryCode || u.country || 'Unknown';
    regionCounts[region] = (regionCounts[region] || 0) + 1;
  }
  return Object.entries(regionCounts)
    .map(([region, userCount]) => ({ region, userCount }))
    .sort((a, b) => b.userCount - a.userCount)
    .slice(0, 20);
}

async function computeDashboardSummary(db, days) {
  const d = parseInt(days, 10) || 30;
  const since = sinceFromDays(d);
  const orderMatch = orderDateMatch(since);
  const orders = await db.collection('orders').find(orderMatch).toArray();

  let totalRevenue = 0;
  let activeOrders = 0;
  let pendingPayments = 0;
  const statusCounts = {};

  for (const o of orders) {
    const status = String(o.status || '');
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    if (status === 'Order Completed' || status === 'Completed') {
      totalRevenue +=
        parseAmount(o.orderSummary?.total) ||
        parseAmount(o.totalDue) ||
        parseAmount(o.confirmedPrice) ||
        parseAmount(o.amount);
    }
    if (!['Order Completed', 'Completed', 'Cancelled'].includes(status)) {
      activeOrders += 1;
    }
    const type = String(o.type || '').toLowerCase();
    if (type === 'sell') {
      if ((o.paymentType || o.lcType) && o.mineralCollected !== true) pendingPayments += 1;
    } else if (status === 'Payment Initiated' || status === 'Price Confirmed') {
      pendingPayments += 1;
    }
  }

  const buyCount = orders.filter((o) => String(o.type || '').toLowerCase() !== 'sell').length;
  const sellCount = orders.length - buyCount;

  return {
    days: d,
    totalOrders: orders.length,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    activeOrders,
    pendingPayments,
    buyOrders: buyCount,
    sellOrders: sellCount,
    statusCounts,
  };
}

module.exports = {
  sinceFromDays,
  computeOverview,
  computeTradingVolume,
  computeMineralCategories,
  computeTopUsers,
  computeRegional,
  computeDashboardSummary,
};
