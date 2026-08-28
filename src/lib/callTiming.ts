import { Contact } from '@/types/contact';

const MIN_NOTES_FOR_TIMING = 3;
// The top bucket needs to represent a real majority of logged calls, not
// just the most common of many scattered options.
const CONFIDENCE_RATIO = 0.5;

type DayBucket = 'weekday' | 'weekend';
type TimeBucket = 'morning' | 'afternoon' | 'evening' | 'night';

const dayLabels: Record<DayBucket, string> = {
  weekday: 'weekdays',
  weekend: 'weekends',
};

const timeLabels: Record<TimeBucket, string> = {
  morning: 'mornings',
  afternoon: 'afternoons',
  evening: 'evenings',
  night: 'late at night',
};

function dayBucket(date: Date): DayBucket {
  const day = date.getDay();
  return day === 0 || day === 6 ? 'weekend' : 'weekday';
}

function timeBucket(date: Date): TimeBucket {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

function topBucket<T extends string>(counts: Map<T, number>, total: number): T | null {
  let best: T | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  if (!best || bestCount / total < CONFIDENCE_RATIO) return null;
  return best;
}

/**
 * Learns which day-of-week and time-of-day window a contact's calls
 * actually tend to land in, purely from their own logged note
 * timestamps - not a schedule anyone set, just what's actually
 * happened. Needs a genuine majority in one bucket before it'll say
 * anything (see CONFIDENCE_RATIO), same spirit as the confidence
 * gating in useCallAnalytics.
 */
export function bestTimeToCall(contact: Contact): string | null {
  const notes = contact.notes || [];
  if (notes.length < MIN_NOTES_FOR_TIMING) return null;

  const dayCounts = new Map<DayBucket, number>();
  const timeCounts = new Map<TimeBucket, number>();

  for (const note of notes) {
    const date = new Date(note.date);
    dayCounts.set(dayBucket(date), (dayCounts.get(dayBucket(date)) || 0) + 1);
    timeCounts.set(timeBucket(date), (timeCounts.get(timeBucket(date)) || 0) + 1);
  }

  const total = notes.length;
  const day = topBucket(dayCounts, total);
  const time = topBucket(timeCounts, total);

  if (day && time) return `${dayLabels[day]} ${timeLabels[time]}`;
  if (day) return dayLabels[day];
  if (time) return timeLabels[time];
  return null;
}
