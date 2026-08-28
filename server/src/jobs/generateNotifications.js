import { query } from '../db.js';
import { sendPushToUser } from '../lib/push.js';
import { sendCalendarReminderEmail } from '../lib/email.js';
import { buildReminderIcs } from '../lib/ics.js';

const FREQUENCY_DAYS = { weekly: 7, biweekly: 14, monthly: 30 };

/** Ported 1:1 from supabase/functions/generate-notifications — same rules,
 * just talking to plain Postgres instead of the Supabase client. */
export async function generateNotifications() {
  const { rows: preferences } = await query(
    `SELECT p.user_id, p.notification_frequency, p.inactivity_days, p.auto_add_calendar_reminders, u.email
     FROM user_preferences p JOIN users u ON u.id = p.user_id
     WHERE p.notifications_enabled = true`
  );

  if (preferences.length === 0) return { created: 0 };

  const now = new Date();
  let totalCreated = 0;

  for (const pref of preferences) {
    const { rows: contacts } = await query(
      'SELECT id, name, call_frequency, last_called FROM contacts WHERE user_id = $1',
      [pref.user_id]
    );
    if (contacts.length === 0) continue;

    const toCreate = [];

    for (const contact of contacts) {
      const lastCalled = contact.last_called ? new Date(contact.last_called) : null;
      const daysSinceLastCall = lastCalled
        ? Math.floor((now.getTime() - lastCalled.getTime()) / 86_400_000)
        : 999;

      const thresholdDays = FREQUENCY_DAYS[contact.call_frequency] ?? 14;
      const needsReminder = daysSinceLastCall >= thresholdDays;

      const { rows: existing } = await query(
        `SELECT id FROM notifications
         WHERE user_id = $1 AND contact_id = $2 AND sent_at IS NULL AND scheduled_for >= $3
         LIMIT 1`,
        [pref.user_id, contact.id, now.toISOString()]
      );
      if (existing.length > 0) continue;

      if (needsReminder) {
        const scheduledFor = new Date(now);
        scheduledFor.setDate(scheduledFor.getDate() + 1);
        toCreate.push({
          title: `Time to call ${contact.name}`,
          message: `It's been ${daysSinceLastCall} days since your last call with ${contact.name}. Stay connected!`,
          type: 'planned_call',
          scheduledFor,
          contactId: contact.id,
        });
      }

      if (daysSinceLastCall >= pref.inactivity_days) {
        const scheduledFor = new Date(now);
        scheduledFor.setDate(scheduledFor.getDate() + 1);
        toCreate.push({
          title: `Haven't connected with ${contact.name} lately?`,
          message: `It's been ${daysSinceLastCall} days since you last spoke. Maybe it's time to reconnect!`,
          type: 'inactivity',
          scheduledFor,
          contactId: contact.id,
        });
      }
    }

    for (const n of toCreate) {
      const { rows: inserted } = await query(
        `INSERT INTO notifications (user_id, contact_id, title, message, type, scheduled_for)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [pref.user_id, n.contactId, n.title, n.message, n.type, n.scheduledFor.toISOString()]
      );
      // Best-effort — a failed push shouldn't stop the rest of the job or
      // roll back the notification row; the in-app bell still shows it.
      sendPushToUser(pref.user_id, { title: n.title, body: n.message }).catch((err) =>
        console.error('sendPushToUser failed:', err)
      );

      // "Add scheduled calls to calendar" — we can't write to a user's
      // personal calendar app directly (that needs OAuth/device access we
      // don't have), so the practical version of this setting is emailing
      // a .ics invite for the reminder, which every major calendar app
      // (Google/Apple/Outlook) can add with one tap. Only for actual
      // planned-call reminders, not the softer inactivity nudges.
      if (n.type === 'planned_call' && pref.auto_add_calendar_reminders && pref.email) {
        const ics = buildReminderIcs({
          uid: `${inserted[0].id}@kallkonnect`,
          start: n.scheduledFor,
          title: n.title,
          description: n.message,
        });
        sendCalendarReminderEmail(pref.email, {
          subject: n.title,
          icsContent: ics,
          icsFilename: 'reminder.ics',
          bodyHtml: `<p>${n.message}</p><p>Attached is a calendar invite for this reminder.</p>`,
        }).catch((err) => console.error('sendCalendarReminderEmail failed:', err));
      }
    }
    totalCreated += toCreate.length;
  }

  return { created: totalCreated };
}
