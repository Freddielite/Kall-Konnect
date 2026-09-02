// Server-side ports of three signals the frontend already computes but that
// the notification job had no access to. Pure — no imports, no DB.
//
//   streaks.ts        -> computeCallStreak
//   noteSignals.ts    -> buildFollowUpVocabulary / matchFollowUpSignal
//   occasions.ts      -> nextOccurrence / upcomingOccasionFor
//
// Kept behaviourally identical to the client versions so the Dashboard and
// the notification you receive can't disagree about the same contact.

// ── Streaks (ported from src/lib/streaks.ts) ──────────────────────────────

export function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Consecutive calendar days ending today or yesterday with at least one
 * logged call note, across all contacts. The yesterday grace period is
 * deliberate — the streak shouldn't read as broken at 00:01 before the user
 * has had a chance to call anyone. */
export function computeCallStreak(noteDates, now = new Date()) {
  const days = new Set(noteDates.map((d) => dayKey(new Date(d))));
  if (days.size === 0) return 0;

  const cursor = new Date(now);
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Streak lengths worth celebrating. Deliberately sparse — a milestone that
 * fires often isn't a milestone. */
export const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100, 200, 365];

export function isStreakMilestone(streak) {
  return STREAK_MILESTONES.includes(streak);
}

// ── Follow-up signal (ported from src/lib/noteSignals.ts) ─────────────────

const MIN_WORD_OCCURRENCES = 3;
const SIGNAL_RATIO_THRESHOLD = 2;
const SHORT_GAP_FACTOR = 0.6;
const LONG_GAP_FACTOR = 1.4;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'was', 'were', 'this', 'they',
  'she', 'him', 'her', 'his', 'have', 'has', 'had', 'about', 'just',
  'really', 'very', 'some', 'from', 'what', 'when', 'then', 'than',
  'into', 'went', 'said', 'told', 'like', 'good', 'nice', 'call',
  'called', 'talk', 'talked', 'chat', 'chatted', 'phone', 'today',
  'yesterday', 'week', 'weeks', 'month', 'months',
]);

function tokenize(text) {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export const EMPTY_VOCABULARY = { signalWords: new Set() };

/** Learns which words tend to precede an unusually short gap before the next
 * call — notes that were quietly signalling "this one needs picking back up".
 * Built from the user's own history, so it costs nothing until there's
 * enough of it. `notesByContact` is a Map of contactId -> [{date, content}]. */
export function buildFollowUpVocabulary(notesByContact) {
  const shortGapCounts = new Map();
  const longGapCounts = new Map();

  for (const notes of notesByContact.values()) {
    const sorted = [...notes].sort((a, b) => new Date(a.date) - new Date(b.date));
    if (sorted.length < 3) continue; // need at least 2 gaps to have an average

    const gaps = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      gaps.push(Math.abs((new Date(sorted[i + 1].date) - new Date(sorted[i].date)) / 86_400_000));
    }
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (avgGap === 0) continue;

    for (let i = 0; i < gaps.length; i++) {
      const words = new Set(tokenize(sorted[i].content));
      const isShort = gaps[i] < avgGap * SHORT_GAP_FACTOR;
      const isLong = gaps[i] > avgGap * LONG_GAP_FACTOR;
      for (const word of words) {
        if (isShort) shortGapCounts.set(word, (shortGapCounts.get(word) || 0) + 1);
        if (isLong) longGapCounts.set(word, (longGapCounts.get(word) || 0) + 1);
      }
    }
  }

  const signalWords = new Set();
  for (const [word, shortCount] of shortGapCounts) {
    if (shortCount < MIN_WORD_OCCURRENCES) continue;
    const longCount = longGapCounts.get(word) || 0;
    if (shortCount >= Math.max(longCount, 1) * SIGNAL_RATIO_THRESHOLD) signalWords.add(word);
  }

  return { signalWords };
}

export function matchFollowUpSignal(text, vocabulary) {
  if (!text || !vocabulary?.signalWords?.size) return false;
  return tokenize(text).some((w) => vocabulary.signalWords.has(w));
}

// ── Occasions (ported from src/lib/occasions.ts) ──────────────────────────

/** How far ahead an occasion is worth a heads-up, plus the day itself.
 * Two touches per occasion, not a daily countdown. */
export const OCCASION_LEAD_DAYS = [3, 0];

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** db.js parses DATE columns as raw "YYYY-MM-DD" strings (see the type
 * parser for OID 1082), so parse the parts by hand — `new Date("1995-06-15")`
 * would be read as UTC midnight and can land on the previous day. */
export function parseDateOnly(value) {
  if (!value) return null;
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** Next yearly recurrence of a month/day, relative to `from`. */
export function nextOccurrence(date, from = new Date()) {
  const today = startOfDay(from);
  let next = new Date(today.getFullYear(), date.getMonth(), date.getDate());
  if (next.getTime() < today.getTime()) {
    next = new Date(today.getFullYear() + 1, date.getMonth(), date.getDate());
  }
  return { date: next, daysUntil: Math.round((next - today) / 86_400_000) };
}

/**
 * The most imminent occasion for a contact that falls on one of the lead
 * days, or null. `specialDates` is [{label, date}].
 */
export function upcomingOccasionFor(contact, specialDates = [], now = new Date()) {
  const candidates = [];

  const birthday = parseDateOnly(contact.birthday);
  if (birthday) candidates.push({ occasionType: 'birthday', label: 'birthday', ...nextOccurrence(birthday, now) });

  const anniversary = parseDateOnly(contact.anniversary);
  if (anniversary) candidates.push({ occasionType: 'anniversary', label: 'anniversary', ...nextOccurrence(anniversary, now) });

  for (const sd of specialDates) {
    const d = parseDateOnly(sd.date);
    if (d) candidates.push({ occasionType: 'special', label: sd.label, ...nextOccurrence(d, now) });
  }

  const due = candidates.filter((c) => OCCASION_LEAD_DAYS.includes(c.daysUntil));
  if (due.length === 0) return null;
  return due.sort((a, b) => a.daysUntil - b.daysUntil)[0];
}

// ── Urgency scoring (ported from src/hooks/useCallAnalytics.ts) ───────────
//
// The Dashboard ranks contacts by this score and shows the top 7. The daily
// notification has to use the SAME ranking, or the push and the screen the
// user opens disagree about who matters today. Kept numerically identical to
// the client version — if you change one, change both.

const MIN_CALLS_FOR_CONFIDENCE = 3;
const FOLLOW_UP_SIGNAL_BOOST = 12;

export function defaultIntervalFor(callFrequency) {
  return { weekly: 7, biweekly: 14, monthly: 30 }[callFrequency] ?? 14;
}

/** Average days between logged calls, or the generic default from the
 * contact's callFrequency when there isn't enough history to know. */
export function averageIntervalFor(contact, notes) {
  const sorted = [...notes].sort((a, b) => new Date(b.date) - new Date(a.date));
  let total = 0;
  let count = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    total += Math.ceil(Math.abs(new Date(sorted[i].date) - new Date(sorted[i + 1].date)) / 86_400_000);
    count++;
  }
  return count > 0 ? Math.round(total / count) : defaultIntervalFor(contact.call_frequency);
}

/**
 * 0-100 urgency. Factors: how far past this contact's own rhythm they are,
 * a follow-up signal in the latest note, favourite status, relationship, and
 * the manual priority field.
 */
export function urgencyScore({ contact, notes = [], daysSinceLastCall, followUpFlagged = false }) {
  const isLowConfidence = notes.length < MIN_CALLS_FOR_CONFIDENCE;
  const averageInterval = averageIntervalFor(contact, notes);

  let score = 0;

  if (daysSinceLastCall > averageInterval) {
    const daysOverdue = daysSinceLastCall - averageInterval;
    // Full weight once we actually know this contact's rhythm; halved while
    // averageInterval is still a guess, so one early call isn't treated as
    // "very overdue" against a schedule we invented.
    const overdueWeight = isLowConfidence ? 0.5 : 1;
    score += Math.min(daysOverdue * 2, 50) * overdueWeight;
  }

  if (followUpFlagged) score += FOLLOW_UP_SIGNAL_BOOST;
  if (contact.is_favorite) score += 20;

  if (contact.relationship === 'family') score += 15;
  else if (contact.relationship === 'friend') score += 10;
  else score += 5;

  score += (contact.priority ?? 0) * 5;

  return { score: Math.min(score, 100), averageInterval, isLowConfidence };
}

/**
 * Picks the one contact to name today.
 *
 * Candidates are all genuinely due, so the job is to cycle through them
 * fairly rather than let the single highest scorer win every morning.
 * Ordering is least-recently-named first, urgency as the tiebreaker — with
 * eight due contacts that surfaces all eight over eight days instead of
 * looping over the top three and never mentioning the rest.
 *
 * A contact named within ROTATION_DAYS is held back entirely. If EVERY
 * candidate is that recent — the normal case for someone with two or three
 * contacts — we fall back to urgency order, because a daily reminder is the
 * point of the app and going silent is worse than repeating a name.
 */
export const ROTATION_DAYS = 3;

export function pickDailyContact(candidates, now = new Date()) {
  if (candidates.length === 0) return null;

  const staleness = (c) => (c.lastNotifiedAt ? new Date(c.lastNotifiedAt).getTime() : -Infinity);
  const byRotation = [...candidates].sort(
    (a, b) => staleness(a) - staleness(b) || b.score - a.score
  );

  const fresh = byRotation.filter(
    (c) => !c.lastNotifiedAt || Math.floor((now - new Date(c.lastNotifiedAt)) / 86_400_000) >= ROTATION_DAYS
  );
  if (fresh.length > 0) return fresh[0];

  return [...candidates].sort((a, b) => b.score - a.score)[0];
}
