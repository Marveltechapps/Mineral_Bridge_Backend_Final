/**
 * Expo Push Notifications - send to app users in real-time
 * https://docs.expo.dev/push-notifications/sending-notifications/
 */
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

async function sendExpoPush(tokens, { title, body, data = {} }) {
  if (!tokens || tokens.length === 0) return;
  const messages = tokens
    .filter((t) => t && typeof t === 'string' && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')))
    .map((token) => ({
      to: token,
      sound: 'default',
      title: title || 'Mineral Bridge',
      body: body || '',
      data: { ...data },
    }));
  if (messages.length === 0) return;
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    const result = await res.json().catch(() => ({}));
    if (result.data?.some((r) => r?.status === 'error')) {
      console.warn('[push] Some notifications failed:', result);
    }
  } catch (err) {
    console.error('[push] Expo send error:', err.message);
  }
}

module.exports = { sendExpoPush };
