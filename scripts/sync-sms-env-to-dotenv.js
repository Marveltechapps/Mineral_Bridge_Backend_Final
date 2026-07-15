/* eslint-disable no-console */
/**
 * Copies config/config.json smsvendor → SMS_VENDOR_URL in .env (for EC2 deploy where config.json is not committed).
 * Safe to run on every start; only writes when SMS_VENDOR_URL is missing/empty and config.json exists.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const configPath = path.join(root, 'config', 'config.json');

function readEnvValue(filePath, key) {
  if (!fs.existsSync(filePath)) return '';
  const match = fs.readFileSync(filePath, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1].trim() : '';
}

function upsertEnvKey(filePath, key, value) {
  let body = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(body)) {
    body = body.replace(re, line);
  } else {
    if (body.length && !body.endsWith('\n')) body += '\n';
    body += `\n# India SMS gateway (synced from config/config.json)\n${line}\n`;
  }
  fs.writeFileSync(filePath, body, 'utf8');
}

try {
  const current = readEnvValue(envPath, 'SMS_VENDOR_URL');
  if (current) {
    console.log('[sync-sms-env] SMS_VENDOR_URL already set in .env');
    process.exit(0);
  }
  if (!fs.existsSync(configPath)) {
    console.log('[sync-sms-env] No config/config.json — set SMS_VENDOR_URL in .env manually on the server');
    process.exit(0);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const url = config?.smsvendor && String(config.smsvendor).trim();
  if (!url) {
    console.log('[sync-sms-env] config/config.json has no smsvendor key');
    process.exit(0);
  }
  upsertEnvKey(envPath, 'SMS_VENDOR_URL', url);
  console.log('[sync-sms-env] Wrote SMS_VENDOR_URL to .env from config/config.json');
} catch (err) {
  console.error('[sync-sms-env] Failed:', err.message);
  process.exit(1);
}
