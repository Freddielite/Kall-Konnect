import { query } from '../db.js';
import { sendPushToUser } from '../lib/push.js';
import { sendCalendarReminderEmail } from '../lib/email.js';
import { buildReminderIcs } from '../lib/ics.js';
import { getValidAccessToken, upsertCalendarEvent } from '../lib/googleCalendar.js';
import { broadcastToUser } from '../ws.js';

const FREQUENCY_DAYS = { weekly: 7, biweekly: 14, monthly: 30 };
const DEFAULT_THRESHOLD_DAYS = 14;

/** How long to stay quiet about a contact after nudging about them once.
 *
 * Equal to the contact's own call frequency, which is the cadence the user
 * actually asked for: a "weekly" contact surfaces at most once a week, a
 * "monthly" one at most once a month. Anything shorter turns an overdue
 * contact into a drip feed — the failure mode this whole change exists to
 * fix. Floor of 2 days guards against a very short custom frequency. */
function cooldownDaysFor(thresholdDays) {
  return Math.max(2, thresholdDays);
}

function daysBetween(from, to) {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/** Picks at most ONE reminder per contact per run.
 *
 * The previous version evaluated `needsReminder` and the inactivity check
 * independently and pushed both, so any contact past both thresholds (the
 * default 14-day inactivity window is exactly biweekly's threshold, so this
 * was most of them) generated two near-identical notifications and two
 * phone pushes on the same morning. Inactivity wins when both apply — it's
 * the stronger signal and its copy is the gentler of the two. */
function chooseReminder({ contact, daysSinceLastCall, neverCalled, inactivityDays, thresholdDays }) {
  if (neverCalled) {
    return {
      type: 'planned_call',
      title: `Say hello to ${contact.name}`,
      // Not "999 days" — last_called is null here, which means we've never
      // seen a call, not that it's been nearly three years.
      message: `You haven't logged a call with ${contact.name} yet. A quick hello is a good place to start.`,
    };
  }

  if (daysSinceLastCall >= inactivityDays) {
    return {
      type: 'inactivity',
      title: `Haven't connected with ${contact.name} lately?`,
      message: `It's been ${daysSinceLastCall} days since you last spoke. Maybe it's time to reconnect!`,
    };
  }

  if (daysSinceLastCall >= thresholdDays) {
    return {
      type: 'planned_call',
      title: `Time to call ${contact.name}`,
      message: `It's been ${daysSinceLastCall} days since your last call with ${contact.name}. Stay connected!`,
    };
  }

  return null;
}

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
    // Two changes from the old query:
    //   1. Snoozed contacts are excluded. `snoozed_until` was already
    //      respected by the Dashboard and by mcpTools.js, but not here —
    //      so snoozing someone via RescheduleDialog silenced them in the
    //      UI while the daily push kept arriving.
    //   2. We pull the most recent notification timestamp per contact so
    //      the cooldown below can be applied without a query per contact.
    const { rows: contacts } = await query(
      `SELECT c.id, c.name, c.call_frequency, c.last_called,
              (SELECT max(n.created_at)
                 FROM notifications n
                WHERE n.user_id = c.user_id AND n.contact_id = c.id) AS last_notified_at
         FROM contacts c
        WHERE c.user_id = $1
          AND (c.snoozed_until IS NULL OR c.snoozed_until <= now())`,
      [pref.user_id]
    );
    if (contacts.length === 0) continue;

    const toCreate = [];

    for (const contact of contacts) {
      const lastCalled = contact.last_called ? new Date(contact.last_called) : null;
      const neverCalled = lastCalled === null;
      const daysSinceLastCall = lastCalled ? daysBetween(lastCalled, now) : Infinity;

      const thresholdDays = FREQUENCY_DAYS[contact.call_frequency] ?? DEFAULT_THRESHOLD_DAYS;

      // Cooldown: if we already raised this contact recently, stay quiet.
      // This is what actually stops the daily-duplicate pile-up; the old
      // `sent_at IS NULL AND scheduled_for >= now()` guard could never fire
      // because sent_at was never written and scheduled_for was always
      // exactly one day out.
      if (contact.last_notified_at) {
        const sinceNotified = daysBetween(new Date(contact.last_notified_at), now);
        if (sinceNotified < cooldownDaysFor(thresholdDays)) continue;
      }

      const reminder = chooseReminder({
        contact,
        daysSinceLastCall,
        neverCalled,
        inactivityDays: pref.inactivity_days,
        thresholdDays,
      });
      if (!reminder) continue;

      toCreate.push({ ...reminder, contactId: contact.id });
    }

    for (const n of toCreate) {
      // scheduled_for is now() rather than now()+1day. The push was always
      // sent the instant the row was created, but GET /notifications filters
      // `scheduled_for <= now()` — so the old code pushed a reminder to the
      // user's phone a full 24 hours before the in-app bell would show it.
      // Tapping the push opened an empty notification list.
      const scheduledFor = now;

      const { rows: inserted } = await query(
        `INSERT INTO notifications (user_id, contact_id, title, message, type, scheduled_for)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [pref.user_id, n.contactId, n.title, n.message, n.type, scheduledFor.toISOString()]
      );
      const notificationId = inserted[0].id;

      // Best-effort — a failed push shouldn't stop the rest of the job or
      // roll back the notification row; the in-app bell still shows it.
      // Awaited (rather than fire-and-forget) purely so sent_at reflects
      // what actually happened.
      try {
        const { delivered } = await sendPushToUser(pref.user_id, { title: n.title, body: n.message });
        if (delivered > 0) {
          await query('UPDATE notifications SET sent_at = now() WHERE id = $1', [notificationId]);
        }
      } catch (err) {
        console.error('sendPushToUser failed:', err);
      }

      // "Add scheduled calls to calendar" — we can't write to a user's
      // personal calendar app directly (that needs OAuth/device access we
      // don't have), so the practical version of this setting is emailing
      // a .ics invite for the reminder, which every major calendar app
      // (Google/Apple/Outlook) can add with one tap.
      //
      // This used to be gated on type === 'planned_call'. Now that the two
      // types are mutually exclusive, that gate would exclude exactly the
      // most overdue contacts — 'inactivity' is the more urgent case, not
      // the softer one. Volume is bounded by the cooldown above either way.
      if (pref.auto_add_calendar_reminders && pref.email) {
        const ics = buildReminderIcs({
          uid: `${notificationId}@kallkonnect`,
          start: scheduledFor,
          title: n.title,
          description: n.message,
        });
        sendCalendarReminderEmail(pref.email, {
          subject: n.title,
          icsContent: ics,
          icsFilename: 'reminder.ics',
          bodyHtml: `<p>${n.message}</p><p>Attached is a calendar invite for this reminder.</p>`,
        }).catch((err) => console.error('sendCalendarReminderEmail failed:', err));

        // If they've separately connected Google Calendar (opt-in, Settings
        // > "Connect Google Calendar"), also push a real event directly —
        // in addition to, not instead of, the .ics email above, since the
        // email path still covers Apple/Outlook/anyone who hasn't connected.
        getValidAccessToken(pref.user_id)
          .then(async (accessToken) => {
            if (!accessToken) return; // not connected — nothing to do
            const eventId = await upsertCalendarEvent({
              accessToken,
              summary: n.title,
              description: n.message,
              start: scheduledFor,
            });
            await query('UPDATE notifications SET google_calendar_event_id = $1 WHERE id = $2', [
              eventId,
              notificationId,
            ]);
          })
          .catch((err) => console.error('Google Calendar event push failed:', err));
      }
    }

    // useNotifications() has always listened for { type: 'notifications' },
    // but nothing on the server ever broadcast it — only routes/contacts.js
    // broadcasts anything. So the bell never live-updated; it only refreshed
    // when the component remounted. One line closes that loop.
    if (toCreate.length > 0) {
      broadcastToUser(pref.user_id, { type: 'notifications' });
    }

    totalCreated += toCreate.length;
  }

  return { created: totalCreated };
}
