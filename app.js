require('dotenv').config();
const express = require('express');
const cors = require('cors');

const mineralsRouter = require('./routes/minerals');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const notificationsRouter = require('./routes/notifications');
const ordersRouter = require('./routes/orders');
const addressesRouter = require('./routes/addresses');
const kycRouter = require('./routes/kyc');
const listingsRouter = require('./routes/listings');
const artisanalRouter = require('./routes/artisanal');
const paymentMethodsRouter = require('./routes/payment_methods');
const transactionsRouter = require('./routes/transactions');
const appSettingsRouter = require('./routes/app_settings');
const marketInsightsRouter = require('./routes/market_insights');
const activityRouter = require('./routes/activity');
const helpRouter = require('./routes/help');
const contentRouter = require('./routes/content');
const chatRouter = require('./routes/chat');
const scheduleRouter = require('./routes/schedule');
const callbacksRouter = require('./routes/callbacks');
const securityAlertsRouter = require('./routes/security_alerts');
const supportConfigRouter = require('./routes/support_config');
const dashboardRouter = require('./routes/dashboard');
const uploadRouter = require('./routes/upload');
const pushTokenRouter = require('./routes/pushToken');

const app = express();

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : true;

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '15mb' }));

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/addresses', addressesRouter);
app.use('/api/kyc', kycRouter);
app.use('/api/listings', listingsRouter);
app.use('/api/artisanal', artisanalRouter);
app.use('/api/payment-methods', paymentMethodsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/app-settings', appSettingsRouter);
app.use('/api/market-insights', marketInsightsRouter);
app.use('/api/activity', activityRouter);
app.use('/api/help', helpRouter);
app.use('/api/content', contentRouter);
app.use('/api/minerals', mineralsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/schedule', scheduleRouter);
app.use('/api/callbacks', callbacksRouter);
app.use('/api/security-alerts', securityAlertsRouter);
app.use('/api/support-config', supportConfigRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/push-token', pushTokenRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mineral-bridge-api' });
});

module.exports = app;
