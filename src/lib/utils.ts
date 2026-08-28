import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats a Date as a local YYYY-MM-DD string.
 *
 * Use this instead of `date.toISOString().split('T')[0]` whenever the Date
 * represents a calendar date (birthday, anniversary, special date) rather
 * than an instant in time. `toISOString()` converts to UTC first, which
 * silently rolls the date back by one day for anyone in a positive UTC
 * offset (e.g. Nigeria, UTC+1) when the Date was constructed at local
 * midnight.
 */
export function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parses a YYYY-MM-DD date-only string as local midnight.
 *
 * Use this instead of `new Date(dateString)` for date-only strings coming
 * back from the database. Per spec, a bare "YYYY-MM-DD" string is parsed
 * as UTC midnight, not local midnight, which shifts the displayed date by
 * one day for anyone in a negative UTC offset.
 */
export function parseLocalDate(dateString: string): Date {
  return new Date(`${dateString}T00:00:00`);
}

/** Extracts a human-readable message from a caught value of unknown type
 * (fetch/DOM errors, thrown strings, etc.) without resorting to `any`.
 *
 * `lib/api.ts` already converts aborted/failed fetches into NetworkError
 * with a message worth reading. This is the backstop for any fetch that
 * doesn't go through it: an aborted request rejects with a DOMException
 * whose message is "signal is aborted without reason", which describes the
 * mechanism that cancelled the request rather than anything the user or
 * developer can act on. Never show it. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError' || /signal is aborted/i.test(error.message)) {
      return 'The request timed out. Check your connection and try again.';
    }
    // Browsers reject fetch() with a bare "Failed to fetch" TypeError for
    // DNS failure, connection-refused and CORS rejection alike.
    if (error.name === 'TypeError' && /failed to fetch|networkerror|load failed/i.test(error.message)) {
      return "Couldn't reach the server. Check your connection and try again.";
    }
    return error.message;
  }
  if (typeof error === 'string') return error;
  return fallback;
}
