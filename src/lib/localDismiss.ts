// Lightweight "not now" for reconnection suggestions - dismissed
// entirely client-side via localStorage, bucketed by calendar day, so
// it's instant (no server round-trip) and naturally resurfaces the
// contact the next day rather than being gone forever like a full
// snooze (see RescheduleDialog / contact.snoozedUntil for that).

const STORAGE_PREFIX = 'kk-dismissed-';

function todayKey(): string {
  const d = new Date();
  return `${STORAGE_PREFIX}${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function getDismissedToday(): Set<string> {
  try {
    const raw = localStorage.getItem(todayKey());
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

export function dismissContactToday(contactId: string): Set<string> {
  const current = getDismissedToday();
  current.add(contactId);
  try {
    localStorage.setItem(todayKey(), JSON.stringify([...current]));
  } catch {
    // localStorage unavailable (private mode, quota) - dismissal just
    // won't persist across reloads, which is a fine fallback.
  }
  return current;
}
