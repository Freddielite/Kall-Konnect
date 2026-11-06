import { query } from '../db.js';
import { env } from '../env.js';
import { sendPushToUser } from '../lib/push.js';
import { isValidTimeZone } from '../lib/validate.js';
import { broadcastToUser } from '../ws.js';
import { STREAK_RISK_MINUTE, isCategoryEnabled, isStreakAtRisk, localDateKey, wallClock } from './reminderRules.js';
import { computeCallStreak, dayKey } from './reminderSignals.js';
import { buildReminder, greetingName } from './reminderCopy.js';
import { pushTargets } from './generateNotifications.js';

/**
 * The evening "keep your streak going" nudge. Runs on the same 15-minute
 * tick as the morning reminders (jobs/cron.js) but is otherwise separate:
 * its own time (19:00 local), its own once-a-day marker
 * (streak_risk_sent_on) and its own Settings toggle (category streak_risk).
 *
 * Fires only when the user has called someone on each of at least the last
 * two days and nobody yet today — see isStreakAtRisk.
 */
export async function generateStreakRiskNudges({ now = new Date(), dryRun = false } = {}) {
  const { rows: users } = await query(
    `SELECT p.user_id, p.notification_categories,
            to_char(p.streak_risk_sent_on, 'YYYY-MM-DD') AS sent_on,
            u.timezone, u.display_name, u.email
       FROM user_preferences p JOIN users u ON u.id = p.user_id
      WHERE p.notifications_enabled = true`
  );
  const fallback = isValidTimeZone(env.cronTimezone) ? env.cronTimezone : 'UTC';
  const plan = [];

  for (const u of users) {
    if (!isCategoryEnabled(u.notification_categories, 'streak_risk')) continue;
    const timeZone = isValidTimeZone(u.timezone) ? u.timezone : fallback;
    const localToday = localDateKey(now, timeZone);
    if (u.sent_on === localToday) continue;
    const localNow = wallClock(now, timeZone);
    if (localNow.getHours() * 60 + localNow.getMinutes() < STREAK_RISK_MINUTE) continue;

    // Enough history for any streak worth protecting (a year, plus slack).
    const { rows: notes } = await query(
      `SELECT n.called_at FROM call_notes n
         JOIN contacts c ON c.id = n.contact_id AND c.deleted_at IS NULL
        WHERE n.user_id = $1 AND n.called_at > now() - interval '400 days'
        ORDER BY n.called_at DESC`,
      [u.user_id]
    );
    const calledToday = notes.some((n) => localDateKey(n.called_at, timeZone) === localToday);
    const streak = computeCallStreak(notes.map((n) => wallClock(n.called_at, timeZone)), localNow);

    if (isStreakAtRisk({ streak, calledToday })) {
      const reminder = buildReminder('streak_risk', {
        streak, userName: greetingName({ displayName: u.display_name, email: u.email }), dayKey: dayKey(localNow),
      });
      plan.push({ userId: u.user_id, streak, reminder });
      if (!dryRun) {
        const { rows } = await query(
          `INSERT INTO notifications (user_id, contact_id, title, message, type, scheduled_for)
           VALUES ($1, NULL, $2, $3, 'streak_risk', now()) RETURNING id`,
          [u.user_id, reminder.title, reminder.message]
        );
        const id = rows[0].id;
        try {
          const { delivered } = await sendPushToUser(u.user_id, {
            title: reminder.title, body: reminder.message,
            icon: '/icon-192.png', badge: '/icon-192.png', tag: 'kk-streak_risk',
            ...pushTargets(id, null),
          });
          if (delivered > 0) await query('UPDATE notifications SET sent_at = now() WHERE id = $1', [id]);
        } catch (err) {
          console.error('[streak-risk] push failed:', err.message);
        }
        broadcastToUser(u.user_id, { type: 'notifications' });
      }
    }
    // Evaluated once per evening either way: a user who calls at 21:00
    // shouldn't then be nudged at 21:15 about a streak that's safe.
    if (!dryRun) {
      await query('UPDATE user_preferences SET streak_risk_sent_on = $2 WHERE user_id = $1', [u.user_id, localToday]);
    }
  }
  return { created: dryRun ? 0 : plan.length, plan };
}
