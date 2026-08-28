/** Minimal single-event .ics builder — no dependency needed for this. */

function formatIcsDate(date) {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function escapeIcsText(text) {
  return String(text).replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
}

/**
 * Builds a single-event VCALENDAR string.
 * `start` is a Date; the event is given a 30-minute default duration since
 * these are call reminders, not fixed-duration meetings.
 */
export function buildReminderIcs({ uid, start, title, description }) {
  const dtStart = formatIcsDate(start);
  const dtEnd = formatIcsDate(new Date(start.getTime() + 30 * 60 * 1000));
  const dtStamp = formatIcsDate(new Date());

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kall Konnect//Reminders//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
