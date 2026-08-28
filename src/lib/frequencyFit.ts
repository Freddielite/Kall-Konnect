import { Contact } from '@/types/contact';

const FREQUENCY_DAYS: Record<Contact['callFrequency'], number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
};

// How far the real observed interval has to drift from the set
// frequency before it's worth suggesting a change, rather than just
// normal week-to-week noise around the same rhythm.
const MISMATCH_RATIO = 1.5;

function closestFrequency(days: number): Contact['callFrequency'] {
  let best: Contact['callFrequency'] = 'weekly';
  let bestDiff = Infinity;
  (Object.keys(FREQUENCY_DAYS) as Contact['callFrequency'][]).forEach((freq) => {
    const diff = Math.abs(FREQUENCY_DAYS[freq] - days);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = freq;
    }
  });
  return best;
}

/**
 * Compares the schedule the user set (contact.callFrequency) against
 * the rhythm they're actually keeping (averageInterval, computed from
 * real note history in useCallAnalytics) and suggests updating it once
 * they've clearly drifted apart - e.g. set to "weekly" but actually
 * checking in every three weeks. Returns null when the two are close
 * enough that it'd just be noise.
 */
export function suggestedFrequency(
  contact: Contact,
  averageInterval: number
): Contact['callFrequency'] | null {
  const currentDays = FREQUENCY_DAYS[contact.callFrequency];
  const ratio = averageInterval / currentDays;
  if (ratio < MISMATCH_RATIO && ratio > 1 / MISMATCH_RATIO) return null;

  const suggestion = closestFrequency(averageInterval);
  return suggestion !== contact.callFrequency ? suggestion : null;
}
