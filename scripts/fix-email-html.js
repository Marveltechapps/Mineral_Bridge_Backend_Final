const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '../routes/dashboard.js');
let s = fs.readFileSync(file, 'utf8');
const start = s.indexOf('function buildMineralBridgeEmailHtml');
const end = s.indexOf('async function resolveUserContact');
if (start === -1 || end === -1) {
  console.error('markers not found');
  process.exit(1);
}
const clean = `function buildMineralBridgeEmailHtml({ title, body, link }) {
  const safeBody = String(body || 'You have a new message from Mineral Bridge.').replace(/</g, '&lt;');
  const linkHtml = link
    ? '<p><a href="' + String(link).replace(/"/g, '&quot;') + '" style="color:#059669;font-weight:600">Open in Mineral Bridge</a></p><p style="word-break:break-all;color:#64748b;font-size:12px;">' + String(link).replace(/</g, '&lt;') + '</p>'
    : '';
  const safeTitle = String(title || 'Mineral Bridge').replace(/</g, '&lt;');
  return '<section style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px">' +
    '<p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#0f172a">' + safeTitle + '</p>' +
    '<p style="margin:0 0 16px;color:#334155;line-height:1.5">' + safeBody + '</p>' +
    linkHtml +
    '<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 12px" />' +
    '<p style="margin:0;font-size:12px;color:#64748b">Sent from Mineral Bridge Dashboard. Please do not reply to this automated message.</p>' +
    '</section>';
}

`;
s = s.slice(0, start) + clean + s.slice(end);
fs.writeFileSync(file, s);
console.log('ok');
