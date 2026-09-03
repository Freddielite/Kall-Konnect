import webpush from 'web-push';
import { env } from '../env.js';
import { query } from '../db.js';

let configured = false;
let warnedUnconfigured = false;

export function isPushConfigured() {
  return Boolean(env.vapidPublicKey && env.vapidPrivateKey);
}

function ensureConfigured() {
  if (configured) return true;
  if (!isPushConfigured()) {
    // Warn once per process rather than on every send. Without this the job
    // logs "created 3 notification(s)" and nothing else, which reads as a
    // success while not a single phone was contacted.
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(
        '[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set, so no push is ' +
          'being sent — notifications only appear in the in-app bell. Generate a ' +
          'pair with `npx web-push generate-vapid-keys` and set both (plus ' +
          'VAPID_SUBJECT) in the environment.'
      );
    }
    return false;
  }
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
  configured = true;
  return true;
}

/** Sends a push payload to every device a user has subscribed from.
 * Silently does nothing if VAPID keys aren't configured yet — push is an
 * optional enhancement, not a hard requirement to run the app.
 *
 * Returns { delivered, failed, subscriptions, reason } so callers can tell the
 * difference between "reached the user's phone" and "went nowhere", and *why*
 * it went nowhere. generateNotifications() uses delivered to stamp
 * notifications.sent_at honestly instead of assuming delivery; the reason is
 * what /push/test surfaces back to the user.
 *
 * A user with no subscribed devices yields delivered: 0, which is a normal
 * outcome, not an error — but it is now a logged one, because "no device has
 * ever subscribed" is by far the most common cause of "push doesn't work"
 * and it used to be completely invisible. */
export async function sendPushToUser(userId, payload) {
  if (!ensureConfigured()) {
    return { delivered: 0, failed: 0, subscriptions: 0, reason: 'vapid-not-configured' };
  }

  const { rows } = await query(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [userId]
  );

  if (rows.length === 0) {
    console.warn(
      `[push] user ${userId} has no registered devices — nothing to send to. ` +
        'They need to open the app and turn on Settings > Enable Notifications ' +
        '(on iOS, only after installing it to the Home Screen).'
    );
    return { delivered: 0, failed: 0, subscriptions: 0, reason: 'no-subscriptions' };
  }

  const errors = [];
  const results = await Promise.all(rows.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
      return true;
    } catch (err) {
      // 403 joins 404/410 here. It means the push service refused our VAPID
      // signature — almost always a subscription created under a previous key
      // pair. Keeping the row retries a send that can never succeed; deleting
      // it lets the client re-subscribe under the current key on next sync.
      if (err?.statusCode === 404 || err?.statusCode === 410 || err?.statusCode === 403) {
        // The push service says this subscription is gone for good
        // (browser uninstalled, permission revoked, etc.) — clean it up
        // so we stop wasting a request on it every time.
        await query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
        errors.push(`${err.statusCode} stale subscription (removed)`);
      } else {
        // Include the host: a 403 from every endpoint at once almost always
        // means the VAPID keys changed after devices subscribed, and each
        // device has to re-subscribe to pick up the new key.
        let host = 'unknown';
        try { host = new URL(sub.endpoint).host; } catch { /* ignore */ }
        console.error('[push] send failed:', host, err?.statusCode, err?.body || err?.message || err);
        errors.push(`${err?.statusCode ?? 'error'} from ${host}`);
      }
      return false;
    }
  }));

  const delivered = results.filter(Boolean).length;
  const failed = results.length - delivered;
  return {
    delivered,
    failed,
    subscriptions: rows.length,
    reason: delivered > 0 ? null : 'all-sends-failed',
    errors,
  };
}
