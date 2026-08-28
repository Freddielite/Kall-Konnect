import { Router } from 'express';
import { query } from '../db.js';

export const notificationsRouter = Router();

notificationsRouter.get('/notifications', async (req, res) => {
  const { rows } = await query(
    `SELECT id, contact_id, title, message, type, scheduled_for, sent_at, read_at, created_at
     FROM notifications
     WHERE user_id = $1 AND scheduled_for <= now()
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
  res.json({ ok: true });
});

notificationsRouter.post('/notifications/read-all', async (req, res) => {
  await query(
    'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
    [req.userId]
  );
  res.json({ ok: true });
});
