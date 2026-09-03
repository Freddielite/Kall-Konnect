import { api } from './api';

/**
 * Push client, rebuilt to mirror the focus-tracker reference exactly.
 *
 * The design rule that matters, and the one an earlier version of this file
 * broke repeatedly: EXACTLY ONE function may request permission or subscribe,
 * and it is only ever called from a direct user gesture. Everything else in
 * here is read-only.
 *
 * Why that rule is load-bearing rather than stylistic: Chrome honours a
 * permission request only inside the brief activation window that follows a
 * real tap. A request raised after a network round-trip — from a status
 * check, a diagnostic, or a sync on page load — shows a prompt that Chrome
 * then dismisses on its own, leaving permission at "default". Worse, each
 * such dismissal counts against the site, and after a few Chrome blocks it
 * permanently with no in-app way back. Multiple subscribe paths don't just
 * duplicate work; they actively burn the limited number of chances the app
 * gets to ask.
 */

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) bytes[i] = rawData.charCodeAt(i);
  return bytes;
}

export type PushStatus = 'unsupported' | 'needs-install' | 'denied' | 'not-subscribed' | 'subscribed';

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

/** Read-only. Never subscribes, never prompts. */
export async function getPushStatus(): Promise<PushStatus> {
  if (!isPushSupported()) return 'unsupported';
  // iOS refuses push outside an installed app, so the useful answer there is
  // "install it first", not "not supported".
  if (isIos() && !isStandalone()) return 'needs-install';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  return existing ? 'subscribed' : 'not-subscribed';
}

/** The ONLY function that requests permission or subscribes.
 * Must be called from a direct user gesture — browsers silently ignore or
 * auto-dismiss permission requests made outside one. Throws with a message
 * suitable for showing to the user. */
export async function enablePush(): Promise<void> {
  if (!isPushSupported()) throw new Error("Push notifications aren't supported in this browser.");

  // First async call in the function, so it still runs inside the tap's
  // activation window. Nothing may be awaited before this line.
  const permission = await Notification.requestPermission();
  if (permission === 'denied') {
    throw new Error(
      'Notifications are blocked for this app. Re-allow them in your browser’s site settings, then try again.'
    );
  }
  if (permission !== 'granted') {
    throw new Error('The prompt closed without an answer. Tap again and choose Allow.');
  }

  const { publicKey } = await api.get<{ publicKey: string | null }>('/push/vapid-public-key');
  if (!publicKey) {
    throw new Error("Push isn't configured on the server yet (missing VAPID keys).");
  }

  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await api.post('/push/subscribe', subscription.toJSON());
}

export async function disablePush(): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    await api.post('/push/unsubscribe', { endpoint: existing.endpoint });
    await existing.unsubscribe();
  }
}

/** Asks the server to push to this account now. Read-only with respect to
 * permission — it cannot prompt, so it is safe to offer at any time. */
export async function sendTestPush(): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await api.post<{ message?: string }>('/push/test', {});
    return { ok: true, message: result.message ?? 'Test notification sent.' };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Could not send a test notification.',
    };
  }
}
