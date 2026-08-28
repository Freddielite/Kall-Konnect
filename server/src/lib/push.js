import webpush from 'web-push';
import { env } from '../env.js';
import { query } from '../db.js';

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  if (!env.vapidPublicKey || !env.vapidPrivateKey) return false;
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
  configured = true;
  return true;
}

/** Sends a push payload to every device a user has subscribed from.
 * Silently does nothing if VAPID keys aren't configured yet — push is an
 * optional enhancement, not a hard requirement to run the app. */
export async function sendPushToUser(userId, payload) {
  if (!ensureConfigured()) return;

  const { rows } = await query(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [userId]
  );

  await Promise.all(rows.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        // The push service says this subscription is gone for good
        // (browser uninstalled, permission revoked, etc.) — clean it up
        // so we stop wasting a request on it every time.
        await query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
      } else {
        console.error('Push send failed:', err?.statusCode, err?.body || err);
      }
    }
  }));
}
