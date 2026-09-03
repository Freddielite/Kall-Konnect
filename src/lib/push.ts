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

/** Brave disables Google's push messaging service by default, for privacy
 * reasons. Web Push in every Chromium browser is delivered over that service,
 * so with it off, subscribe() fails with "Registration failed - push service
 * error" no matter how correct the app is. Nothing in this codebase can work
 * around it; the user has to flip the setting. */
async function isBrave(): Promise<boolean> {
  const nav = navigator as { brave?: { isBrave?: () => Promise<boolean> } };
  try {
    return (await nav.brave?.isBrave?.()) === true;
  } catch {
    return false;
  }
}

/** Turns a raw subscribe() failure into something a person can act on. The
 * browser's own wording ("push service error") names the layer that failed
 * but not the cause, which sends people looking for bugs in the app. */
export async function explainSubscribeError(err: unknown): Promise<string> {
  const raw = err instanceof Error ? err.message : String(err);

  if (/push service error|Registration failed|AbortError/i.test(raw)) {
    if (await isBrave()) {
      return (
        'Brave blocks the push service by default. Open brave://settings/privacy, ' +
        'turn on "Use Google services for push messaging", restart Brave completely, ' +
        'then try again. Or use Chrome, where it works without changing anything.'
      );
    }
    return (
      'The browser could not reach its push service. This usually means push ' +
      'messaging is disabled in the browser\'s settings, or a privacy extension ' +
      'is blocking it. Trying in Chrome is the quickest way to confirm.'
    );
  }

  return raw;
}

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
  let subscription: PushSubscription;
  try {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  } catch (err) {
    throw new Error(await explainSubscribeError(err));
  }

  await api.post('/push/subscribe', subscription.toJSON());
}

/** Re-syncs this device's subscription to the server.
 *
 * CANNOT PROMPT, and so does not violate the one-subscribe-path rule above:
 * it returns immediately unless permission is already granted, and once it is,
 * neither getSubscription() nor subscribe() shows any UI.
 *
 * This is needed because the browser's view and the server's view drift apart
 * silently. The server deletes a subscription the moment a push service
 * reports it dead (404/410/403), which is correct — but the browser still
 * holds that subscription object and happily reports itself subscribed, so
 * the UI says "receiving reminders" while the server has no row to send to.
 * Anything that changes the VAPID keys, or a round of stale rows being culled,
 * lands you exactly there.
 *
 * Also repairs a key mismatch: a subscription created under an older VAPID
 * public key is accepted locally forever while every send is rejected. */
export async function ensureRegistered(): Promise<void> {
  if (!isPushSupported()) return;
  if (Notification.permission !== 'granted') return;

  const { publicKey } = await api.get<{ publicKey: string | null }>('/push/vapid-public-key');
  if (!publicKey) return;

  const reg = await navigator.serviceWorker.ready;
  let subscription = await reg.pushManager.getSubscription();

  if (subscription) {
    const current = subscription.options?.applicationServerKey;
    if (current && !sameKey(current, publicKey)) {
      await subscription.unsubscribe();
      subscription = null;
    }
  }

  subscription =
    subscription ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  // Posted unconditionally. The endpoint upserts, so re-sending a row the
  // server already has is harmless; not sending one it lacks is silent
  // failure.
  await api.post('/push/subscribe', subscription.toJSON());
}

function sameKey(current: ArrayBuffer, serverKeyBase64: string): boolean {
  const expected = urlBase64ToUint8Array(serverKeyBase64) as Uint8Array;
  const actual = new Uint8Array(current);
  if (actual.length !== expected.length) return false;
  return actual.every((byte, i) => byte === expected[i]);
}

/** Throws away this device's subscription and creates a genuinely new one.
 *
 * getSubscription() can keep returning an object the push service has already
 * discarded — clearing site data or reinstalling the app does exactly this.
 * Re-posting that object achieves nothing: the server sends, gets 410 Gone,
 * deletes the row, and the next sync posts the same dead endpoint again. The
 * only way out is to unsubscribe locally first, which forces the browser to
 * mint a new endpoint.
 *
 * Cannot prompt: permission is already granted by the time this runs. */
export async function forceResubscribe(): Promise<void> {
  if (!isPushSupported()) return;
  if (Notification.permission !== 'granted') return;

  const { publicKey } = await api.get<{ publicKey: string | null }>('/push/vapid-public-key');
  if (!publicKey) throw new Error("Push isn't configured on the server.");

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    // Tell the server to drop it too, so a dead endpoint can't linger in the
    // table if the unsubscribe below succeeds but a later step fails.
    await api.post('/push/unsubscribe', { endpoint: existing.endpoint }).catch(() => {});
    await existing.unsubscribe().catch(() => {});
  }

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
    // Re-sync first. Otherwise a test can fail purely because the server's
    // copy was culled, which reads as "push is broken" when the fix is one
    // upsert away.
    await ensureRegistered();
    const result = await api.post<{ message?: string }>('/push/test', {});
    return { ok: true, message: result.message ?? 'Test notification sent.' };
  } catch (err) {
    // A failed send means the endpoint the browser gave us is dead. Retrying
    // with the same one is pointless, so mint a new subscription and try once
    // more. One retry only — if a fresh endpoint also fails, the problem is
    // not staleness and looping would just hide it.
    try {
      await forceResubscribe();
      const retry = await api.post<{ message?: string }>('/push/test', {});
      return { ok: true, message: retry.message ?? 'Test notification sent.' };
    } catch (retryErr) {
      return {
        ok: false,
        message: retryErr instanceof Error ? retryErr.message : 'Could not send a test notification.',
      };
    }
  }
}
