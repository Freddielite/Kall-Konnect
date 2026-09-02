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
 * optional enhancement, not a hard requirement to run the app.
 *
 * Returns { delivered, failed } so callers can tell the difference between
 * "reached the user's phone" and "went nowhere". generateNotifications()
 * uses this to stamp notifications.sent_at honestly instead of assuming
 * delivery. A user with no subscribed devices yields delivered: 0, which
 * is a normal outcome, not an error. */
export async function sendPushToUser(userId, payload) {
  if (!ensureConfigured()) return { delivered: 0, failed: 0 };

  const { rows } = await query(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [userId]
  );

  const results = await Promise.all(rows.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
      return true;
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        // The push service says this subscription is gone for good
        // (browser uninstalled, permission revoked, etc.) — clean it up
        // so we stop wasting a request on it every time.
        await query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
      } else {
        console.error('Push send failed:', err?.statusCode, err?.body || err);
      }
      return false;
    }
  }));

  const delivered = results.filter(Boolean).length;
  return { delivered, failed: results.length - delivered };
}
