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
