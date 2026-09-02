import { Router } from 'express';
import { query } from '../db.js';

export const preferencesRouter = Router();

const PATCHABLE_PREFERENCE_FIELDS = [
  'notifications_enabled', 'reminder_time', 'theme', 'notification_frequency',
  'inactivity_days', 'preferred_platforms', 'call_frequency', 'reminder_tone',
  'favorite_contacts', 'preferred_call_time', 'auto_add_calendar_reminders',
  'quiet_day_nudges', 'notification_categories',
];

preferencesRouter.get('/preferences', async (req, res) => {
  const { rows } = await query('SELECT * FROM user_preferences WHERE user_id = $1', [req.userId]);
  if (!rows[0]) return res.status(404).json({ error: 'Preferences not found' });
  res.json(rows[0]);
});

preferencesRouter.patch('/preferences', async (req, res) => {
  const updates = req.body ?? {};
  const setClauses = [];
  const values = [];
  for (const field of PATCHABLE_PREFERENCE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(updates, field)) {
      const isJson =
        field === 'preferred_platforms' ||
        field === 'favorite_contacts' ||
        field === 'notification_categories';
      values.push(isJson ? JSON.stringify(updates[field]) : updates[field]);
      setClauses.push(`${field} = $${values.length}`);
    }
  }
  if (setClauses.length === 0) return res.json({ ok: true });

  values.push(req.userId);
  try {
    const { rowCount } = await query(
      `UPDATE user_preferences SET ${setClauses.join(', ')} WHERE user_id = $${values.length}`,
      values
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Preferences not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('update preferences error:', err);
    res.status(400).json({ error: err.message });
  }
});
