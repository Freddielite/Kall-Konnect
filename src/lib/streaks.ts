import { Contact } from '@/types/contact';

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Consecutive calendar days, ending today or yesterday, with at least
 * one logged call note across any contact. Ending at "yesterday" too
 * (not just "today") is a deliberate grace period - the streak
 * shouldn't already read as broken at 12:01am before the user has had
 * a chance to call anyone today.
 */
export function computeCallStreak(contacts: Contact[]): number {
  const daysWithCalls = new Set<string>();
  for (const contact of contacts) {
    for (const note of contact.notes || []) {
      daysWithCalls.add(dayKey(new Date(note.date)));
    }
  }
  if (daysWithCalls.size === 0) return 0;

  const cursor = new Date();
  if (!daysWithCalls.has(dayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  while (daysWithCalls.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
