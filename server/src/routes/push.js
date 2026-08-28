import { Router } from 'express';
import { query } from '../db.js';
import { env } from '../env.js';
import { requireAuth } from '../middleware/requireAuth.js';

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
