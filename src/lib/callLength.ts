import { Contact } from '@/types/contact';

// Same "needs to happen a few times to be a real pattern, not a fluke"
// bar as MIN_CALLS_FOR_CONFIDENCE in useCallAnalytics and MIN_NOTES_FOR_TIMING
// in lib/callTiming - below this many measured durations, one unusually
// long or short call could skew the average into meaninglessness.
const MIN_DURATIONS_FOR_CONFIDENCE = 3;

/**
 * Typical call length for a contact, learned from real elapsed-time-away
 * durations captured automatically when a call note is saved (see
 * Dashboard's visibility-based post-call flow) - not anything the user
 * types in, just what's actually happened on past calls. Quick returns
 * that never made it to a saved note (likely unconnected/cancelled calls)
 * never produce a duration in the first place, so they don't drag the
 * average down.
 */
export function typicalCallLength(contact: Contact): string | null {
  const durations = (contact.notes || [])
    .map(note => note.duration)
    .filter((duration): duration is number => typeof duration === 'number' && duration > 0);

  if (durations.length < MIN_DURATIONS_FOR_CONFIDENCE) return null;

  const average = Math.round(
    durations.reduce((sum, duration) => sum + duration, 0) / durations.length
  );
  if (average < 1) return null;

  return `~${average} min`;
}
