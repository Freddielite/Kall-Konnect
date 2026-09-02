import { query } from '../db.js';
import { sendPushToUser } from '../lib/push.js';
import { sendCalendarReminderEmail } from '../lib/email.js';
import { buildReminderIcs } from '../lib/ics.js';
import { getValidAccessToken, upsertCalendarEvent } from '../lib/googleCalendar.js';
import { broadcastToUser } from '../ws.js';
import { chooseScenario, daysBetween, thresholdDaysFor } from './reminderRules.js';
import { buildReminder, greetingName, toneForContact } from './reminderCopy.js';
import {
  buildFollowUpVocabulary,
  computeCallStreak,
  dayKey,
  isStreakMilestone,
  matchFollowUpSignal,
  pickDailyContact,
  upcomingOccasionFor,
  urgencyScore,
} from './reminderSignals.js';

/** Occasions are time-critical and can't be rescheduled, so they're the one
 * scenario allowed past the per-contact cooldown. They have their own
 * narrower guard instead: OCCASION_LEAD_DAYS is [3, 0], so at most two
 * touches per occasion, and this stops the second from repeating. */
const OCCASION_REPEAT_GUARD_DAYS = 2;

/** One routine reminder per user per day, naming one person.
 *
 * The app exists so people don't forget to call, so the cadence to the USER
 * is daily. What must not be daily is nudging about the same PERSON — that's
 * handled by rotation (pickDailyContact), not by going quiet. An earlier
 * version applied the per-contact cooldown to delivery itself, which meant
 * five pushes on Monday and silence until Friday. Wrong app.
 *
 * Occasions are exempt: two people can share a birthday, and missing one
 * because we'd already "used up" the day would be the worst failure this
 * job has. In practice occasions are rare, so the daily count is 1 almost
 * every day. The cap itself is enforced where the pick happens, below. */

/** `dryRun` computes exactly the same plan but writes nothing, sends no
 * push, no email and no broadcast — it just reports what a real run would
 * do. Used by `npm run notifications-doctor`, because the only other way to
 * exercise this job is to wait for the 06:00 cron. */
export async function generateNotifications({ dryRun = false } = {}) {
  const { rows: preferences } = await query(
    `SELECT p.user_id, p.notification_frequency, p.inactivity_days, p.auto_add_calendar_reminders,
            u.email, u.display_name
     FROM user_preferences p JOIN users u ON u.id = p.user_id
     WHERE p.notifications_enabled = true`
  );

  if (preferences.length === 0) return { created: 0, plan: [] };

  const now = new Date();
  const today = dayKey(now);
  let totalCreated = 0;
  const plan = [];

  for (const pref of preferences) {
    // Snoozed contacts are excluded here. `snoozed_until` was already
    // respected by the Dashboard and by mcpTools.js, but not by this job —
    // so snoozing via RescheduleDialog silenced a contact in the UI while
    // the daily push kept arriving.
    const { rows: contacts } = await query(
      `SELECT c.id, c.name, c.call_frequency, c.last_called, c.relationship,
              c.template_tone, c.birthday, c.anniversary, c.is_favorite, c.priority,
              (SELECT max(n.created_at)
                 FROM notifications n
                WHERE n.user_id = c.user_id AND n.contact_id = c.id) AS last_notified_at,
              (SELECT max(n.created_at)
                 FROM notifications n
                WHERE n.user_id = c.user_id AND n.contact_id = c.id AND n.type = 'occasion')
                AS last_occasion_at
         FROM contacts c
        WHERE c.user_id = $1
          AND (c.snoozed_until IS NULL OR c.snoozed_until <= now())`,
      [pref.user_id]
    );
    if (contacts.length === 0) continue;

    // Everything below is per-user context the copy layer can draw on.
    const { rows: notes } = await query(
      'SELECT contact_id, content, created_at FROM call_notes WHERE user_id = $1 ORDER BY created_at',
      [pref.user_id]
    );
    const { rows: specialDates } = await query(
      'SELECT contact_id, label, date FROM special_dates WHERE user_id = $1',
      [pref.user_id]
    );

    const notesByContact = new Map();
    for (const n of notes) {
      if (!notesByContact.has(n.contact_id)) notesByContact.set(n.contact_id, []);
      notesByContact.get(n.contact_id).push({ date: n.created_at, content: n.content });
    }
    const specialByContact = new Map();
    for (const sd of specialDates) {
      if (!specialByContact.has(sd.contact_id)) specialByContact.set(sd.contact_id, []);
      specialByContact.get(sd.contact_id).push(sd);
    }

    const vocabulary = buildFollowUpVocabulary(notesByContact);
    const streak = computeCallStreak(notes.map((n) => n.created_at), now);
    const userName = greetingName({ displayName: pref.display_name, email: pref.email });

    const toCreate = [];
    const routineCandidates = [];

    for (const contact of contacts) {
      const lastCalled = contact.last_called ? new Date(contact.last_called) : null;
      const neverCalled = lastCalled === null;
      const daysSinceLastCall = lastCalled ? daysBetween(lastCalled, now) : Infinity;
      const thresholdDays = thresholdDaysFor(contact.call_frequency);

      const contactNotes = notesByContact.get(contact.id) ?? [];
      const lastNote = contactNotes[contactNotes.length - 1];
      const followUpMatched = matchFollowUpSignal(lastNote?.content, vocabulary);

      const occasion = upcomingOccasionFor(contact, specialByContact.get(contact.id) ?? [], now);

      // Occasions are time-critical and unrepeatable, so they bypass both
      // the rotation and the one-a-day cap. Their own guard stops repeats:
      // OCCASION_LEAD_DAYS is [3, 0], so two touches per occasion.
      if (occasion) {
        const repeated =
          contact.last_occasion_at &&
          daysBetween(new Date(contact.last_occasion_at), now) < OCCASION_REPEAT_GUARD_DAYS;
        if (!repeated) {
          toCreate.push({
            ...buildReminder('occasion', {
              contact, userName, tone: toneForContact(contact), days: daysSinceLastCall,
              streak, dayKey: today, occasionType: occasion.occasionType,
              label: occasion.label, daysUntil: occasion.daysUntil,
            }),
            contactId: contact.id, contactName: contact.name, scenario: 'occasion',
          });
        }
        continue; // an occasion contact isn't also a routine candidate today
      }

      const scenario = chooseScenario({
        occasion: null,
        followUpMatched,
        neverCalled,
        daysSinceLastCall,
        inactivityDays: pref.inactivity_days,
        thresholdDays,
      });
      if (!scenario) continue;

      const { score } = urgencyScore({
        contact,
        notes: contactNotes,
        daysSinceLastCall: daysSinceLastCall === Infinity ? 999 : daysSinceLastCall,
        followUpFlagged: followUpMatched,
      });

      routineCandidates.push({
        contact, scenario, score, daysSinceLastCall,
        lastNotifiedAt: contact.last_notified_at,
      });
    }

    // One person named per day. Rotation prefers someone not nudged in the
    // last few days, but falls back to the most urgent when everyone has
    // been — a user with two contacts should still hear from us daily.
    // Skipped entirely on a day an occasion already fired, so a birthday
    // doesn't arrive alongside a routine nudge.
    if (routineCandidates.length > 0 && toCreate.length === 0) {
      const chosen = pickDailyContact(routineCandidates, now);
      toCreate.push({
        ...buildReminder(chosen.scenario, {
          contact: chosen.contact,
          userName,
          tone: toneForContact(chosen.contact),
          days: chosen.daysSinceLastCall,
          streak,
          dayKey: today,
          alsoDue: routineCandidates.length - 1,
        }),
        contactId: chosen.contact.id,
        contactName: chosen.contact.name,
        scenario: chosen.scenario,
      });
    }

    // Nothing due at all — still say something, so the daily rhythm the app
    // is trying to build doesn't have holes in it. Deliberately short and
    // free of manufactured urgency.
    if (toCreate.length === 0) {
      toCreate.push({
        ...buildReminder('nudge', { userName, streak, dayKey: today }),
        contactId: null, contactName: null, scenario: 'nudge',
      });
    }

    // Streaks are a property of the user, not a contact. Only milestones get
    // their own notification — a "your streak is at risk" nudge can't work on
    // a 06:00 job, since at 6am nobody has had a chance to call anyone yet.
    // A live streak instead colours the copy of whatever else fired.
    if (isStreakMilestone(streak)) {
      const { rows: recentStreak } = await query(
        `SELECT 1 FROM notifications
          WHERE user_id = $1 AND type = 'streak' AND created_at > now() - interval '1 day' LIMIT 1`,
        [pref.user_id]
      );
      if (recentStreak.length === 0) {
        toCreate.push({
          ...buildReminder('streak', { streak, userName, dayKey: today }),
          contactId: null, contactName: null, scenario: 'streak',
        });
      }
    }

    plan.push({ userId: pref.user_id, email: pref.email, userName, streak,
                reminders: toCreate, dueCount: routineCandidates.length });
    if (dryRun) continue;

    for (const n of toCreate) {
      // scheduled_for is now() rather than now()+1day. The push was always
      // sent the instant the row was created, but GET /notifications filters
      // `scheduled_for <= now()` — so the old code pushed a reminder to the
      // user's phone a full 24 hours before the in-app bell would show it.
      const scheduledFor = now;

      const { rows: inserted } = await query(
        `INSERT INTO notifications (user_id, contact_id, title, message, type, scheduled_for)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [pref.user_id, n.contactId, n.title, n.message, n.type, scheduledFor.toISOString()]
      );
      const notificationId = inserted[0].id;

      // Best-effort — a failed push shouldn't stop the rest of the job or
      // roll back the notification row; the in-app bell still shows it.
      // Awaited only so sent_at reflects what actually happened.
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
      // don't have), so the practical version of this setting is emailing a
      // .ics invite, which every major calendar app can add with one tap.
      // Skipped for streak notifications, which aren't about a call.
      if (pref.auto_add_calendar_reminders && pref.email && n.contactId) {
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
        // > "Connect Google Calendar"), also push a real event directly.
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
    // broadcasts anything. So the bell never live-updated.
    if (toCreate.length > 0) broadcastToUser(pref.user_id, { type: 'notifications' });

    totalCreated += toCreate.length;
  }

  return { created: totalCreated, plan };
}
