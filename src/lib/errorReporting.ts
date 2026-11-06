import { API_URL } from './api';

/**
 * Sends uncaught browser errors to the server (POST /client-errors), which
 * logs them and forwards them to the team's error webhook. Without this, a
 * crash on someone's phone is invisible unless they write in.
 *
 * Deliberately small: each distinct message is sent once per page load, at
 * most 10 per page load, and known noise is dropped. Never throws, and
 * never sends anything but the error itself and the current path.
 */
const MAX_PER_SESSION = 10;
const sent = new Set<string>();

const NOISE = [
  /ResizeObserver loop/i, // benign browser warning
  /^Script error\.?$/i, // cross-origin script with no details
  /chrome-extension:|moz-extension:|safari-extension:/i, // someone's browser extension
];

function report(message: string, stack?: string) {
  if (!message || sent.size >= MAX_PER_SESSION || sent.has(message)) return;
  if (NOISE.some((re) => re.test(message) || (stack && re.test(stack)))) return;
  sent.add(message);
  try {
    fetch(`${API_URL}/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      keepalive: true,
      body: JSON.stringify({
        message: message.slice(0, 500),
        stack: stack?.slice(0, 3000),
        path: window.location.pathname,
        release: import.meta.env.MODE,
      }),
    }).catch(() => {});
  } catch {
    // Reporting must never cause an error of its own.
  }
}

export function installErrorReporting() {
  window.addEventListener('error', (event) => {
    const err = event.error as Error | undefined;
    report(err?.message ?? event.message, err?.stack);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as unknown;
    if (reason instanceof Error) report(reason.message, reason.stack);
    else report(typeof reason === 'string' ? reason : 'Unhandled promise rejection');
  });
}
