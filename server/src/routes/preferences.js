import { Router } from 'express';
import { query } from '../db.js';
import { pick, bool, int, str, oneOf, arrayOf, timeOfDay, ValidationError } from '../lib/validate.js';
import { NOTIFICATION_CATEGORIES } from '../jobs/reminderRules.js';

export const preferencesRouter = Router();

const categories = () => (v, field) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new ValidationError(`${field} must be an object`);
  const out = {};
  for (const [k, on] of Object.entries(v)) {
    if (!NOTIFICATION_CATEGORIES.includes(k)) throw new ValidationError(`${field}.${k} is not a notification category`);
    if (typeof on !== 'boolean') throw new ValidationError(`${field}.${k} must be true or false`);
    out[k] = on;
  }
  return out;
};

/** Every patchable column, with the same limits the schema's CHECKs (and
 * the reminder job) assume. */
const PREFERENCE_FIELDS = {
  notifications_enabled: bool(),
  reminder_time: timeOfDay(),
  theme: oneOf(['light', 'dark', 'system']),
  notification_frequency: oneOf(['daily', 'weekly', 'monthly']),
  inactivity_days: int({ min: 1, max: 365 }),
  preferred_platforms: arrayOf(str({ min: 1, max: 40 }), { max: 20 }),
  call_frequency: oneOf(['weekly', 'biweekly', 'monthly']),
  reminder_tone: oneOf(['friendly', 'professional', 'casual']),
  favorite_contacts: arrayOf(str({ min: 1, max: 64 }), { max: 1000 }),
  preferred_call_time: oneOf(['morning', 'afternoon', 'evening', 'anytime']),
  auto_add_calendar_reminders: bool(),
  quiet_day_nudges: bool(),
  notification_categories: categories(),
};
const JSON_FIELDS = new Set(['preferred_platforms', 'favorite_contacts', 'notification_categories']);

preferencesRouter.get('/preferences', async (req, res) => {
  const { rows } = await query('SELECT * FROM user_preferences WHERE user_id = $1', [req.userId]);
  if (!rows[0]) return res.status(404).json({ error: 'Preferences not found' });
  res.json(rows[0]);
});

preferencesRouter.patch('/preferences', async (req, res) => {
  const updates = pick(req.body ?? {}, PREFERENCE_FIELDS, { partial: true });
  const fields = Object.keys(updates);
  if (fields.length === 0) return res.json({ ok: true });

  const values = fields.map((f) => (JSON_FIELDS.has(f) ? JSON.stringify(updates[f]) : updates[f]));
  values.push(req.userId);
  const { rowCount } = await query(
    `UPDATE user_preferences SET ${fields.map((f, i) => `${f} = $${i + 1}`).join(', ')}
      WHERE user_id = $${values.length}`,
    values
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Preferences not found' });
  res.json({ ok: true });
});
