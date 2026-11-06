import { Router } from 'express';
import { query } from '../db.js';
import { verifyPassword } from '../lib/passwords.js';
import { normalizeEmail } from '../lib/validate.js';
import { clearAuthCookies } from '../lib/cookies.js';
import { disconnectGoogleCalendar } from '../lib/googleCalendar.js';
import { disconnectUser } from '../ws.js';
import { tokenLimiter } from '../middleware/rateLimit.js';

export const accountRouter = Router();

/**
 * Everything stored about the signed-in user, as one JSON file: profile,
 * settings, contacts (including recently deleted ones), call notes, special
 * dates, reminders and registered devices. Excludes only secrets: the
 * password hash, session and reset tokens, the Google Calendar token and
 * push encryption keys.
 */
accountRouter.get('/account/export', async (req, res) => {
  const one = async (sql) => (await query(sql, [req.userId])).rows;
  const [profile] = await one(
    `SELECT id, email, display_name, email_verified, timezone, created_at,
            google_sub IS NOT NULL AS google_sign_in_linked,
            google_calendar_email, google_calendar_connected_at
       FROM users WHERE id = $1`
  );
  const [preferences] = await one(
    `SELECT notifications_enabled, reminder_time, theme, notification_frequency, inactivity_days,
            preferred_platforms, call_frequency, favorite_contacts, preferred_call_time,
            auto_add_calendar_reminders, quiet_day_nudges, notification_categories
       FROM user_preferences WHERE user_id = $1`
  );
  const data = {
    exportedAt: new Date().toISOString(),
    format: 'kall-konnect-export/1',
    profile,
    preferences,
    contacts: await one('SELECT * FROM contacts WHERE user_id = $1 ORDER BY created_at'),
    callNotes: await one(
      'SELECT id, contact_id, content, duration, called_at, created_at FROM call_notes WHERE user_id = $1 ORDER BY called_at'
    ),
    specialDates: await one('SELECT id, contact_id, label, date, created_at FROM special_dates WHERE user_id = $1'),
    notifications: await one(
      `SELECT id, contact_id, type, title, message, created_at, sent_at, read_at, opened_at, acted_at
         FROM notifications WHERE user_id = $1 ORDER BY created_at`
    ),
    devices: (await one('SELECT endpoint, created_at FROM push_subscriptions WHERE user_id = $1'))
      .map((d) => ({ pushService: new URL(d.endpoint).host, registeredAt: d.created_at })),
  };
  for (const c of data.contacts) delete c.user_id;

  const day = new Date().toISOString().slice(0, 10);
  res.set({
    'Content-Disposition': `attachment; filename="kall-konnect-export-${day}.json"`,
    'Cache-Control': 'no-store',
  });
  res.type('application/json').send(JSON.stringify(data, null, 2));
});

/**
 * Permanently deletes the account and everything in it, at once: every
 * table referencing users cascades. Backups age out on the provider's own
 * retention schedule (see DEPLOYING.md §10).
 *
 * Confirmation: the account's password, or for an account with no password
 * (Google-only) the email address typed out.
 */
accountRouter.delete('/account', tokenLimiter, async (req, res) => {
  const { password, email } = req.body ?? {};
  const { rows } = await query('SELECT email, password_hash FROM users WHERE id = $1', [req.userId]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'Account not found' });

  const confirmed = user.password_hash
    ? await verifyPassword(password, user.password_hash)
    : normalizeEmail(email) === normalizeEmail(user.email);
  if (!confirmed) {
    return res.status(403).json({
      error: user.password_hash ? 'That password is not correct.' : 'Type your email address exactly to confirm.',
    });
  }

  await disconnectGoogleCalendar(req.userId);
  await query('DELETE FROM users WHERE id = $1', [req.userId]);
  disconnectUser(req.userId);
  clearAuthCookies(res);
  console.log(`[account] deleted user ${req.userId}`);
  res.status(204).end();
});
