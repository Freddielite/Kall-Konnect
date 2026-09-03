import { Router } from 'express';
import { query } from '../db.js';
import { env } from '../env.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { sendPushToUser, isPushConfigured } from '../lib/push.js';

export const pushRouter = Router();

// Public — the frontend needs this before it can even ask the browser to
// subscribe, and it's not secret data.
pushRouter.get('/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: env.vapidPublicKey || null });
});

pushRouter.post('/push/subscribe', requireAuth, async (req, res) => {
  const { endpoint, keys } = req.body ?? {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'endpoint and keys.p256dh/keys.auth are required' });
  }

  try {
    await query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4`,
      [req.userId, endpoint, keys.p256dh, keys.auth]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('push subscribe error:', err);
    res.status(400).json({ error: err.message });
  }
});

pushRouter.post('/push/unsubscribe', requireAuth, async (req, res) => {
  const { endpoint } = req.body ?? {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
  await query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, req.userId]);
  res.status(204).end();
});

/**
 * Send a push to the caller's own devices, right now.
 *
 * This exists because "push notifications aren't working" has at least four
 * distinct causes that all look identical from the outside: the daily job
 * never ran, VAPID isn't configured on the server, this device never
 * subscribed, or the push service is rejecting our sends. Waiting until 06:00
 * to test tells you nothing about which one it is. This does, in one tap.
 */
pushRouter.post('/push/test', requireAuth, async (req, res) => {
  if (!isPushConfigured()) {
    return res.status(503).json({
      ok: false,
      reason: 'vapid-not-configured',
      // `error` and `message` carry the same text: the frontend api client
      // reads `error` when the status is non-2xx, everything else reads
      // `message`. Keeping both means the user sees the real explanation
      // instead of a bare "Request failed (503)".
      error:
        'The server has no VAPID keys, so it cannot send push at all. Set ' +
        'VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT and redeploy.',
      message:
        'The server has no VAPID keys, so it cannot send push at all. Set ' +
        'VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT and redeploy.',
    });
  }

  const result = await sendPushToUser(req.userId, {
    title: 'Kall Konnect test',
    body: 'Push notifications are working on this device.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'kk-test',
    url: '/settings',
    data: { type: 'test' },
  });

  if (result.subscriptions === 0) {
    return res.status(409).json({
      ok: false,
      reason: 'no-subscriptions',
      error:
        'No device is registered for push on this account. Turn Enable ' +
        'Notifications off and on again and accept the browser prompt. On ' +
        'iPhone, the app must be added to the Home Screen first.',
      message:
        'No device is registered for push on this account. Turn Enable ' +
        'Notifications off and on again and accept the browser prompt. On ' +
        'iPhone, the app must be added to the Home Screen first.',
      ...result,
    });
  }

  if (result.delivered === 0) {
    return res.status(502).json({
      ok: false,
      reason: 'all-sends-failed',
      error:
        'The push service rejected every send. If the VAPID keys were changed ' +
        'after this device subscribed, it has to subscribe again.',
      message:
        'The push service rejected every send. If the VAPID keys were changed ' +
        'after this device subscribed, it has to subscribe again.',
      ...result,
    });
  }

  res.json({ ok: true, message: `Sent to ${result.delivered} device(s).`, ...result });
});

/** Read-only view of why push might not be reaching this account. Safe to
 * expose to the logged-in user: it returns counts and hostnames, never keys
 * or subscription secrets. */
pushRouter.get('/push/diagnostics', requireAuth, async (req, res) => {
  const { rows } = await query(
    'SELECT endpoint, created_at FROM push_subscriptions WHERE user_id = $1',
    [req.userId]
  );

  const devices = rows.map((r) => {
    let host = 'unknown';
    try { host = new URL(r.endpoint).host; } catch { /* ignore */ }
    return { pushService: host, subscribedAt: r.created_at };
  });

  res.json({
    vapidConfigured: isPushConfigured(),
    cronSecretConfigured: Boolean(env.cronSecret),
    deviceCount: devices.length,
    devices,
  });
});
