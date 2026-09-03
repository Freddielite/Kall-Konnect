import { api } from './api';

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) bytes[i] = rawData.charCodeAt(i);
  return bytes;
}

/** 'denied' is a dead end that no amount of retrying fixes — the browser will
 * not prompt again — so the UI has to branch on this rather than offering a
 * button that can only fail. */
export function getPermissionState(): NotificationPermission | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

/** Whether this is an installed PWA rather than a browser tab. Matters for
 * un-blocking instructions: the permission lives with the site in the
 * browser, which an installed app has no UI to reach. */
export function isInstalledApp(): boolean {
  return isStandalone();
}

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** iOS/iPadOS only allow Web Push from an app installed to the Home Screen.
 * In plain Safari, PushManager exists but subscribe() rejects — so the generic
 * "not supported" message is wrong and unhelpful there. */
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

export async function isPushEnabled(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return !!subscription;
}

/** Fires whenever the notification permission changes — including when the
 * user allows it from Chrome's site settings, entirely outside this page.
 *
 * Without this, someone who follows the un-blocking instructions comes back to
 * an app still insisting notifications are blocked, and has to know to press a
 * refresh button. Returns an unsubscribe function. */
export function onPermissionChange(callback: (state: NotificationPermission) => void): () => void {
  if (!('permissions' in navigator)) return () => {};
  let cleanup = () => {};
  void navigator.permissions
    .query({ name: 'notifications' as PermissionName })
    .then((status) => {
      const handler = () => callback(status.state as NotificationPermission);
      status.addEventListener('change', handler);
      cleanup = () => status.removeEventListener('change', handler);
    })
    .catch(() => {});
  return () => cleanup();
}

/** Requests permission, registers the service worker, and subscribes.
 * Returns why it failed when it does, so the UI can show something useful
 * instead of a silent no-op. */
export async function enablePushNotifications(): Promise<{ ok: boolean; reason?: string }> {
  if (!isPushSupported()) return { ok: false, reason: 'Push notifications are not supported in this browser.' };

  if (isIos() && !isStandalone()) {
    return {
      ok: false,
      reason:
        'On iPhone and iPad, push only works once the app is installed. Tap Share, ' +
        'then "Add to Home Screen", open it from there, and turn this on again.',
    };
  }

  // Requested before any await, so it still runs inside the activation window
  // that follows the user's tap. Chrome silently auto-dismisses a permission
  // request made after a network round-trip, which leaves permission at
  // "default" and looks to the user like the prompt did nothing.
  const permission = await Notification.requestPermission();
  if (permission === 'denied') {
    return {
      ok: false,
      reason:
        'Notifications are blocked for this app. The browser will not ask ' +
        'again — re-allow them in site settings, then try once more.',
    };
  }
  if (permission !== 'granted') {
    // 'default' means the prompt was dismissed (swiped away, or the app lost
    // focus) rather than refused. Nothing is broken and it can simply be
    // asked again, so the wording should not sound like a refusal.
    return {
      ok: false,
      reason: 'The prompt closed without an answer. Tap again and choose Allow.',
    };
  }

  const { publicKey } = await api.get<{ publicKey: string | null }>('/push/vapid-public-key');
  if (!publicKey) return { ok: false, reason: 'Push is not configured on the server yet.' };

  try {
    // Inside the try: registration is the single most likely thing to fail on
    // a real deployment (a host that serves index.html for /sw.js, a bad
    // MIME type, an insecure origin), and it used to throw straight past the
    // caller — no toast, no error, the screen simply did nothing.
    const registration = await withTimeout(
      registerServiceWorker(),
      15_000,
      'The service worker did not activate within 15 seconds.'
    );

    const existing = await registration.pushManager.getSubscription();
    let subscription = existing;

    // A subscription created against an older VAPID public key keeps working
    // locally but every send from the server is rejected — which presents as
    // "it says notifications are on, nothing ever arrives". Compare the key
    // this device subscribed with against the one the server is using now,
    // and re-subscribe if they differ.
    if (subscription) {
      const current = subscription.options?.applicationServerKey;
      if (current && !sameKey(current, publicKey)) {
        await subscription.unsubscribe();
        subscription = null;
      }
    }

    subscription =
      subscription ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));

    await api.post('/push/subscribe', subscription.toJSON());
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'The browser refused the push subscription.',
    };
  }
}

/** navigator.serviceWorker.ready never rejects — if no worker ever activates
 * it simply hangs, which presents as a button that does nothing at all,
 * forever. Every await on it needs a deadline. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  // Register, then resolve against serviceWorker.ready rather than the
  // registration object returned above. ready resolves for whichever worker is
  // actually ACTIVE, which is what pushManager needs; the returned registration
  // can still be in 'installing' when a fresh worker is being deployed, and
  // subscribing against it fails intermittently in exactly the way that looks
  // like a flaky bug. This is what the focus-tracker reference does.
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

function sameKey(current: ArrayBuffer, serverKeyBase64: string): boolean {
  const expected = urlBase64ToUint8Array(serverKeyBase64) as Uint8Array;
  const actual = new Uint8Array(current);
  if (actual.length !== expected.length) return false;
  return actual.every((byte, i) => byte === expected[i]);
}

/** Re-registers this device silently, without ever showing a prompt.
 *
 * Why this is needed: `notifications_enabled` defaults to true, so the
 * Settings switch reads ON for a brand-new user who has never granted
 * permission and never subscribed. enablePushNotifications() only runs from
 * the switch's onChange, which never fires because nobody toggles a switch
 * that already looks right — so the account sits in "reminders on, zero
 * registered devices" forever and every push silently goes nowhere.
 *
 * The same gap opens whenever a subscription is lost for reasons the user
 * never sees: clearing site data, a long-dormant install, or the server's
 * VAPID keys being set after the user first turned reminders on.
 *
 * Only acts when permission is ALREADY granted, so it can run on every load
 * without ambushing anyone with a permission dialog. Returns whether this
 * device now has a working subscription. */
export async function syncPushSubscription(): Promise<boolean> {
  if (!isPushSupported()) return false;
  if (Notification.permission !== 'granted') return false;
  if (isIos() && !isStandalone()) return false;

  try {
    const { publicKey } = await api.get<{ publicKey: string | null }>('/push/vapid-public-key');
    if (!publicKey) return false;

    const registration = await withTimeout(
      registerServiceWorker(),
      15_000,
      'The service worker did not activate within 15 seconds.'
    );

    let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const current = subscription.options?.applicationServerKey;
      if (current && !sameKey(current, publicKey)) {
        await subscription.unsubscribe();
        subscription = null;
      }
    }

    subscription =
      subscription ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));

    // Posted every time, not just on fresh subscribes: the browser can hold a
    // valid subscription the server has no row for (different account, wiped
    // database, failed POST last time). The endpoint upserts, so this is cheap.
    await api.post('/push/subscribe', subscription.toJSON());
    return true;
  } catch (err) {
    console.error('Push subscription sync failed:', err);
    return false;
  }
}

/** Whether this specific device is registered with the server — as opposed to
 * isPushEnabled(), which only asks the browser. The two disagree exactly when
 * something is broken, which is when it matters. */
export async function isDeviceRegistered(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const { deviceCount } = await api.get<{ deviceCount: number }>('/push/diagnostics');
    const local = await isPushEnabled();
    return local && deviceCount > 0;
  } catch {
    return false;
  }
}

/** Asks the server to push to this account right now. Returns the server's
 * explanation when it can't, which is the whole point — it distinguishes
 * "server has no keys" from "this device never subscribed" from "the push
 * service rejected us". */
export async function sendTestPush(): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await api.post<{ ok: boolean; message: string }>('/push/test', {});
    return { ok: true, message: result.message ?? 'Test notification sent.' };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Could not send a test notification.',
    };
  }
}

export async function disablePushNotifications(): Promise<void> {
  if (!isPushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration('/sw.js');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await api.post('/push/unsubscribe', { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}

export interface DiagnosticStage {
  name: string;
  ok: boolean;
  detail: string;
}

/** Walks the push setup and reports where it breaks.
 *
 * STRICTLY READ-ONLY. An earlier version of this subscribed as it went, which
 * was a bad idea for a reason that took a while to surface: subscribe() raises
 * the permission prompt itself, and by the time the check reached it several
 * network round-trips had passed. Chrome only honours a permission request
 * inside the brief activation window that follows a real tap, so the prompt
 * was auto-dismissed — leaving permission at "default" and creating a
 * duplicate device row. A diagnostic that changes what it is measuring is
 * worse than no diagnostic. This one only observes. */
export async function diagnosePushSetup(): Promise<DiagnosticStage[]> {
  const stages: DiagnosticStage[] = [];
  const add = (name: string, ok: boolean, detail: string) => stages.push({ name, ok, detail });

  if (!('serviceWorker' in navigator)) {
    add('Browser support', false, 'This browser has no service worker support.');
    return stages;
  }
  if (!window.isSecureContext) {
    add('Secure origin', false, `Page is not a secure context (${window.location.origin}). Push requires HTTPS.`);
    return stages;
  }
  add('Browser support', true, 'Service workers and Push API are available.');

  if (isIos() && !isStandalone()) {
    add('Installed app', false, 'On iOS, push requires the app to be added to the Home Screen.');
    return stages;
  }

  const permission = Notification.permission;
  add(
    'Permission',
    permission === 'granted',
    permission === 'granted'
      ? 'Notifications are allowed.'
      : permission === 'denied'
        ? 'Blocked. The browser will not ask again; it has to be re-allowed in site settings.'
        : 'Not granted yet. The prompt was dismissed rather than answered — tap "Turn on reminders" and choose Allow.'
  );

  try {
    const res = await fetch('/sw.js', { cache: 'no-store' });
    const type = res.headers.get('content-type') ?? 'unknown';
    const isScript = res.ok && /javascript|ecmascript/i.test(type);
    add('sw.js is served correctly', isScript, isScript ? `HTTP ${res.status}, ${type}` : `HTTP ${res.status}, content-type "${type}".`);
  } catch (err) {
    add('sw.js is served correctly', false, err instanceof Error ? err.message : 'Could not fetch /sw.js.');
  }

  const registration = await navigator.serviceWorker.getRegistration('/sw.js');
  add(
    'Service worker active',
    Boolean(registration?.active),
    registration?.active ? `Scope: ${registration.scope}` : 'No active worker registered on this device.'
  );

  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  add(
    'Browser subscription',
    Boolean(subscription),
    subscription ? 'This device holds a push subscription.' : 'This device has no subscription yet.'
  );

  try {
    const { deviceCount, vapidConfigured } = await api.get<{ deviceCount: number; vapidConfigured: boolean }>(
      '/push/diagnostics'
    );
    add('Server can send push', vapidConfigured, vapidConfigured ? 'VAPID keys are configured.' : 'Server has no VAPID keys.');
    add('Server sees this device', deviceCount > 0, `${deviceCount} device(s) registered on this account.`);
  } catch (err) {
    add('Server reachable', false, err instanceof Error ? err.message : 'Request failed.');
  }

  // The single most misread state: everything green except permission means
  // push arrives and is then silently discarded, because a service worker
  // cannot draw a notification the user hasn't allowed.
  if (permission !== 'granted' && subscription) {
    add(
      'Why nothing appears',
      false,
      'Messages reach this device and are discarded undisplayed, because notifications are not allowed yet. The server correctly reports them as sent.'
    );
  }

  return stages;
}

/** Shows a notification directly from the page, with no server and no push
 * service involved.
 *
 * This isolates the last ambiguous case. When the server reports a successful
 * send and nothing appears, the message was accepted by Google's push service
 * — so the subscription, the VAPID keys and the encryption are all fine, and
 * the failure is somewhere on the device. If this local notification also
 * fails to appear, the phone is suppressing display (OS-level notification
 * settings, battery optimisation, or a manufacturer ROM killing background
 * delivery) and no amount of server-side work will fix it. If it DOES appear,
 * display works and the problem is specifically the delivery path. */
export async function showLocalTestNotification(): Promise<{ ok: boolean; message: string }> {
  if (!isPushSupported()) return { ok: false, message: 'Not supported in this browser.' };
  if (Notification.permission !== 'granted') {
    return { ok: false, message: `Permission is "${Notification.permission}", so nothing can be shown.` };
  }

  try {
    const registration = await withTimeout(
      registerServiceWorker(),
      15_000,
      'The service worker did not activate within 15 seconds.'
    );
    await registration.showNotification('Kall Konnect local test', {
      body: 'If you can see this, your phone can display notifications.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'kk-local-test',
    });
    return {
      ok: true,
      message: 'Shown. If nothing appeared, your phone is blocking notifications for this app.',
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not show a notification.' };
  }
}
