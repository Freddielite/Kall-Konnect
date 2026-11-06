// Pure decision logic for the daily reminder job — deliberately free of any
// imports, so it can be unit-tested without a database, a .env file, or
// even `npm install`. See generateNotifications.test.js.

export const FREQUENCY_DAYS = { weekly: 7, biweekly: 14, monthly: 30 };
export const DEFAULT_THRESHOLD_DAYS = 14;

/** A follow-up nudge only makes sense once a beat has passed since the call. */
export const FOLLOW_UP_MIN_DAYS = 2;

/** How long to stay quiet about a contact after nudging about them once.
 *
 * Equal to the contact's own call frequency, which is the cadence the user
 * actually asked for: a "weekly" contact surfaces at most once a week, a
 * "monthly" one at most once a month. Anything shorter turns an overdue
 * contact into a drip feed — the failure mode this whole change exists to
 * fix. Floor of 2 days guards against a very short custom frequency. */
export function cooldownDaysFor(thresholdDays) {
  return Math.max(2, thresholdDays);
}

export function daysBetween(from, to) {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

export function thresholdDaysFor(callFrequency) {
  return FREQUENCY_DAYS[callFrequency] ?? DEFAULT_THRESHOLD_DAYS;
}

/**
 * Picks at most ONE scenario per contact per run, in priority order, or
 * null if the contact isn't due for anything.
 *
 * Priority is by specificity, not urgency: a birthday beats "you're
 * overdue" because it's time-critical and unrepeatable, and a follow-up
 * beats a generic nudge because it names an actual reason to call. The
 * previous version evaluated the frequency and inactivity checks
 * independently and emitted BOTH, so a contact past both thresholds got two
 * near-identical notifications and two phone pushes the same morning.
 *
 * `occasion` is the only scenario allowed to bypass the cooldown — see
 * generateNotifications — since a birthday can't be rescheduled.
 */
export function chooseScenario({
  occasion,
  followUpMatched,
  neverCalled,
  daysSinceLastCall,
  inactivityDays,
  thresholdDays,
}) {
  if (occasion) return 'occasion';
  if (neverCalled) return 'first_call';
  if (followUpMatched && daysSinceLastCall >= FOLLOW_UP_MIN_DAYS) return 'follow_up';
  if (daysSinceLastCall >= inactivityDays) return 'inactivity';
  if (daysSinceLastCall >= thresholdDays) return 'planned_call';
  return null;
}

/** Days between routine reminders, from user_preferences.notification_frequency.
 * This setting has existed in the schema and in the Settings screen since the
 * Supabase days and was read by nothing — the job always ran daily regardless
 * of what the user picked. */
export const FREQUENCY_PERIOD_DAYS = { daily: 1, weekly: 7, monthly: 30 };

export function periodDaysFor(notificationFrequency) {
  return FREQUENCY_PERIOD_DAYS[notificationFrequency] ?? 1;
}

// ── Time zones ──────────────────────────────────────────────────────────
//
// The job runs on a UTC server for users all over the world. "Today",
// "tomorrow" and "9am" have to mean the user's own wall clock, or a daily
// reminder fires at 4am, or skips a day.

const formatters = new Map();
function partsIn(date, timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }));
  }
  const out = {};
  for (const { type, value } of formatters.get(timeZone).formatToParts(date)) out[type] = Number(value);
  return out;
}

/**
 * The user's wall-clock time, as a Date whose *local* fields (getHours,
 * getDate...) read as that time. The rest of the job does its date maths
 * with local-time Date methods; handing it a wall-clock Date makes all of
 * that maths happen in the user's timezone with no other changes. Only
 * meaningful for those local fields — don't compare it to real instants.
 */
export function wallClock(date, timeZone) {
  const p = partsIn(new Date(date), timeZone);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** Whole calendar days from `from` to `to`, counted on the user's clock:
 * 23:59 to 00:01 the next day is 1, though only 2 minutes apart. */
export function calendarDaysBetween(from, to, timeZone) {
  const a = partsIn(new Date(from), timeZone);
  const b = partsIn(new Date(to), timeZone);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

/** The user's local date `days` after today's, as YYYY-MM-DD. Steps the
 * calendar date itself, so it's right across DST changes. */
export function localDateKeyPlusDays(date, timeZone, days) {
  const p = partsIn(new Date(date), timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day + days)).toISOString().slice(0, 10);
}

/** The user's local date as YYYY-MM-DD. */
export function localDateKey(date, timeZone) {
  const p = partsIn(new Date(date), timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * The local time the day's reminder goes out, as minutes after midnight.
 *
 * Settings shows "Preferred Call Time" as windows (Morning 8am–12pm,
 * Afternoon 12pm–5pm, Evening 5pm–9pm), so the reminder lands at the start
 * of the chosen window — the moment the user said they'd like to call.
 * "Anytime" falls back to reminder_time (default 09:00).
 */
export const CALL_WINDOW_START = { morning: 8 * 60, afternoon: 12 * 60, evening: 17 * 60 };

export function reminderMinuteOfDay({ preferredCallTime, reminderTime }) {
  if (CALL_WINDOW_START[preferredCallTime] !== undefined) return CALL_WINDOW_START[preferredCallTime];
  const m = /^(\d{2}):(\d{2})$/.exec(reminderTime ?? '');
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return Number(m[1]) * 60 + Number(m[2]);
  return 9 * 60;
}

/** True once the user's local clock has reached today's reminder time.
 * "Reached", not "equal": a run that's late (a restart, a sleeping free
 * instance) still delivers, and reminders_processed_on stops repeats. */
export function hasReminderTimePassed({ now, timeZone, preferredCallTime, reminderTime }) {
  const p = partsIn(now, timeZone);
  return p.hour * 60 + p.minute >= reminderMinuteOfDay({ preferredCallTime, reminderTime });
}

/**
 * Whether a routine reminder is due for this user today.
 *
 * Counted in calendar days on the user's clock. It used to be whole
 * 24-hour periods, which skipped every other day: yesterday's reminder is
 * written a few seconds after the run starts, so at the same minute today
 * only 23h59m have passed — floor() makes that 0 days, "not due".
 *
 * Occasions and streak milestones ignore this — they're events, not a
 * cadence. Only the once-per-period "here's who to call" reminder and the
 * quiet-day nudge are gated.
 */
export function isRoutineDue({ lastRoutineAt, notificationFrequency, now = new Date(), timeZone = 'UTC' }) {
  if (!lastRoutineAt) return true;
  return calendarDaysBetween(lastRoutineAt, now, timeZone) >= periodDaysFor(notificationFrequency);
}

/** Categories a user can switch off individually in Settings. Keys match
 * notifications.type. The quiet-day `nudge` has its own separate toggle
 * (quiet_day_nudges), so it isn't listed here. */
export const NOTIFICATION_CATEGORIES = [
  'planned_call', 'inactivity', 'occasion', 'follow_up', 'first_call', 'streak', 'streak_risk',
];

/** Local time the evening streak nudge becomes due: 19:00. Late enough that
 * a day without a call is meaningful, early enough to still act on it. */
export const STREAK_RISK_MINUTE = 19 * 60;

/** A streak is at risk in the evening when it's at least 2 days long (one
 * day isn't a streak worth protecting) and nothing has been logged today.
 * `streak` counts consecutive days ending yesterday when today is empty. */
export function isStreakAtRisk({ streak, calledToday }) {
  return !calledToday && streak >= 2;
}

/**
 * A category is enabled unless explicitly switched off. Missing keys mean
 * "on", so a preferences row written before a category existed — or before
 * migration 009 ran — doesn't silently go quiet.
 */
export function isCategoryEnabled(categories, type) {
  if (!categories || typeof categories !== 'object') return true;
  return categories[type] !== false;
}
