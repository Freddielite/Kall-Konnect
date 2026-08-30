/**
 * How long the user needs to have actually been away from the app for a
 * "return" (via the Page Visibility API) to plausibly represent a real
 * conversation, rather than a cancelled dial, a call that never connected,
 * or the OS's own native "Call / Cancel" confirmation sheet briefly
 * stealing focus. Below this, there's nothing worth prompting for and
 * nothing worth feeding into the local learning engine (lib/callTiming,
 * lib/callLength, lib/streaks) - it would just be noise.
 */
export const QUICK_RETURN_THRESHOLD_MS = 10_000;

export function isQuickReturn(elapsedMs: number): boolean {
  return elapsedMs < QUICK_RETURN_THRESHOLD_MS;
}
