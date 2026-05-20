require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const os = require('os');
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./config/db');
const { initRedis } = require('./config/redis');

function getLocalIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips.length ? ips : ['127.0.0.1'];
}
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
const mediaRouter = require('./routes/media');

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

// In development, IPs/ports change frequently (Expo, LAN DHCP).
// Allow all origins so the app can always fetch content endpoints.
const corsOrigin =
  (process.env.NODE_ENV || '').toLowerCase() === 'development'
    ? true
    : (allowedOrigins.length ? allowedOrigins : true);

app.use(cors({ origin: corsOrigin }));
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
app.use('/api/media', mediaRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mineral-bridge-api' });
});

// Return JSON for unmatched routes (helps debug 404s)
app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

initRedis();

connectDB()
  .then(() => {
    console.log('MongoDB: connected');
    const server = app.listen(Number(PORT), HOST, () => {
      const port = Number(PORT);
      console.log(`Mineral Bridge API running on port ${port}`);
      console.log(`  Local:   http://localhost:${port}`);
      getLocalIPs().forEach((ip) => {
        console.log(`  Network: http://${ip}:${port}  (use this IP in Expo .env)`);
      });
      console.log(`  Example: GET http://localhost:${port}/api/minerals`);
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${PORT} in use — killing old process and retrying...`);
        const { execSync } = require('child_process');
        try {
          if (process.platform === 'win32') {
            const out = execSync(`netstat -ano | findstr :${PORT} | findstr LISTENING`, { encoding: 'utf8' });
            const pids = [...new Set(out.trim().split(/\r?\n/).map(l => l.trim().split(/\s+/).pop()).filter(Boolean))];
            pids.forEach(pid => { try { execSync(`taskkill /F /PID ${pid}`); } catch {} });
          } else {
            execSync(`lsof -ti:${PORT} | xargs kill -9`);
          }
          setTimeout(() => {
            app.listen(Number(PORT), HOST, () => {
              console.log(`Mineral Bridge API running on port ${PORT} (after retry)`);
            });
          }, 1000);
        } catch (killErr) {
          console.error('Could not free port:', killErr.message);
          process.exit(1);
        }
      } else {
        console.error('Server error:', err);
        process.exit(1);
      }
    });
  })
  .catch((err) => {
    console.error('MongoDB: not connected -', err.message);
    process.exit(1);
  });
