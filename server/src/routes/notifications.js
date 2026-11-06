import { Router } from 'express';
import { query } from '../db.js';
import { env } from '../env.js';
import { broadcastToUser } from '../ws.js';
import { verifyActionToken } from '../lib/actionTokens.js';
import { isValidTimeZone } from '../lib/validate.js';
import { localDateKeyPlusDays } from '../jobs/reminderRules.js';
import { tokenLimiter } from '../middleware/rateLimit.js';

export const notificationsRouter = Router();

/** Mounted WITHOUT requireAuth (see index.js): the service worker calls it
 * from the lock screen with a signed token instead of a session. */
export const notificationActionsRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const checkId = (req, res, next, id) => (UUID.test(id) ? next() : res.status(404).json({ error: 'Notification not found' }));
notificationsRouter.param('id', checkId);
notificationActionsRouter.param('id', checkId);

notificationsRouter.get('/notifications', async (req, res) => {
  const { rows } = await query(
    `SELECT id, contact_id, title, message, type, scheduled_for, sent_at, read_at, created_at
     FROM notifications
     WHERE user_id = $1 AND scheduled_for <= now()
       -- Reminders about a contact in the trash stay hidden until it's restored.
       AND (contact_id IS NULL OR contact_id NOT IN (
             SELECT id FROM contacts WHERE user_id = $1 AND deleted_at IS NOT NULL))
     ORDER BY scheduled_for DESC
     LIMIT 20`,
    [req.userId]
  );
  res.json(rows);
});

notificationsRouter.post('/notifications/:id/read', async (req, res) => {
  const { rowCount } = await query(
    'UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2',
    [req.params.id, req.userId]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Notification not found' });
  // Keeps the bell's unread badge in sync across a user's other open
  // tabs/devices — the originating client already updated optimistically.
  broadcastToUser(req.userId, { type: 'notifications' });
  res.json({ ok: true });
});

notificationsRouter.post('/notifications/read-all', async (req, res) => {
  await query(
    'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
    [req.userId]
  );
  broadcastToUser(req.userId, { type: 'notifications' });
  res.json({ ok: true });
});

/** The app was opened from this push (the `kkn` link parameter). Feeds
 * opened_at for `npm run reminder-report`; also counts as read. */
notificationsRouter.post('/notifications/:id/opened', async (req, res) => {
  const { rowCount } = await query(
    `UPDATE notifications SET opened_at = COALESCE(opened_at, now()), read_at = COALESCE(read_at, now())
      WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.userId]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Notification not found' });
  broadcastToUser(req.userId, { type: 'notifications' });
  res.json({ ok: true });
});

/**
 * "Remind me tomorrow": tomorrow's reminder (in the user's own timezone) is
 * about this notification's contact, whatever the rotation would pick. The
 * reminder job reads contacts.remind_next_on. Returns the date, or null if
 * the notification isn't about a contact.
 */
async function remindTomorrow(notificationId, userId) {
  const { rows } = await query(
    `SELECT n.user_id, n.contact_id, u.timezone FROM notifications n JOIN users u ON u.id = n.user_id
      WHERE n.id = $1 AND ($2::uuid IS NULL OR n.user_id = $2)`,
    [notificationId, userId]
  );
  const n = rows[0];
  if (!n?.contact_id) return null;
  const tz = isValidTimeZone(n.timezone) ? n.timezone : (isValidTimeZone(env.cronTimezone) ? env.cronTimezone : 'UTC');
  const tomorrow = localDateKeyPlusDays(new Date(), tz, 1);
  await query(
    'UPDATE contacts SET remind_next_on = $3 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [n.contact_id, n.user_id, tomorrow]
  );
  await query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1', [notificationId]);
  broadcastToUser(n.user_id, { type: 'notifications' });
  return tomorrow;
}

/** From inside the app (the fallback when the lock-screen button had to
 * open it). */
notificationsRouter.post('/notifications/:id/remind-tomorrow', async (req, res) => {
  const on = await remindTomorrow(req.params.id, req.userId);
  if (!on) return res.status(404).json({ error: 'Notification not found' });
  res.json({ ok: true, remindOn: on });
});

/** From the service worker, authorized by the signed token in the push. */
notificationActionsRouter.post('/notifications/:id/snooze', tokenLimiter, async (req, res) => {
  if (!verifyActionToken(req.query.t, req.params.id, 'snooze')) {
    return res.status(403).json({ error: 'This link has expired.' });
  }
  const on = await remindTomorrow(req.params.id, null);
  if (!on) return res.status(404).json({ error: 'Notification not found' });
  res.json({ ok: true, remindOn: on });
});
