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
  const registration = await navigator.serviceWorker.getRegistration('/sw.js');
  const subscription = await registration?.pushManager.getSubscription();
  return !!subscription;
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

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'Notification permission was not granted.' };

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
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  return registration;
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

/** Walks the push setup one stage at a time and reports where it breaks.
 *
 * Every stage below has, at some point, been the sole reason push "didn't
 * work" — and from the outside they all look identical: a toggle that stays
 * on and a phone that stays silent. Guessing between them remotely is
 * expensive, so this just asks each question directly and shows the answer. */
export async function diagnosePushSetup(): Promise<DiagnosticStage[]> {
  const stages: DiagnosticStage[] = [];
  const add = (name: string, ok: boolean, detail: string) => stages.push({ name, ok, detail });

  if (!('serviceWorker' in navigator)) {
    add('Browser support', false, 'This browser has no service worker support.');
    return stages;
  }
  if (!window.isSecureContext) {
    // http:// on a LAN IP is the usual cause. Push requires a secure origin;
    // localhost is exempt, a bare IP is not.
    add('Secure origin', false, `Page is not a secure context (${window.location.origin}). Push requires HTTPS.`);
    return stages;
  }
  add('Browser support', true, 'Service workers and Push API are available.');

  if (isIos() && !isStandalone()) {
    add('Installed app', false, 'On iOS, push requires the app to be added to the Home Screen.');
    return stages;
  }

  add('Permission', Notification.permission === 'granted', `Notification.permission is "${Notification.permission}".`);

  // Fetch the worker script directly. A host that rewrites unknown paths to
  // index.html returns HTML here, and the browser refuses to register a
  // worker with a text/html MIME type — the error is easy to miss in a
  // console you can't open on a phone.
  try {
    const res = await fetch('/sw.js', { cache: 'no-store' });
    const type = res.headers.get('content-type') ?? 'unknown';
    const isScript = res.ok && /javascript|ecmascript/i.test(type);
    add(
      'sw.js is served correctly',
      isScript,
      isScript
        ? `HTTP ${res.status}, ${type}`
        : `HTTP ${res.status}, content-type "${type}". The host is serving something other than JavaScript at /sw.js — usually index.html from a catch-all rewrite.`
    );
  } catch (err) {
    add('sw.js is served correctly', false, err instanceof Error ? err.message : 'Could not fetch /sw.js.');
  }

  let registration: ServiceWorkerRegistration | null = null;
  try {
    registration = await withTimeout(registerServiceWorker(), 15_000, 'Timed out waiting for the worker to activate.');
    add('Service worker active', true, `Scope: ${registration.scope}`);
  } catch (err) {
    add('Service worker active', false, err instanceof Error ? err.message : 'Registration failed.');
    return stages;
  }

  let publicKey: string | null = null;
  try {
    ({ publicKey } = await api.get<{ publicKey: string | null }>('/push/vapid-public-key'));
    add('Server VAPID key', Boolean(publicKey), publicKey ? 'Server returned a public key.' : 'Server returned no key.');
  } catch (err) {
    add('Server VAPID key', false, err instanceof Error ? err.message : 'Request failed.');
    return stages;
  }
  if (!publicKey) return stages;

  let subscription: PushSubscription | null = null;
  try {
    subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const current = subscription.options?.applicationServerKey;
      const matches = !current || sameKey(current, publicKey);
      add(
        'Browser subscription',
        matches,
        matches ? 'This device holds a subscription matching the server key.' : 'Subscription was made with a DIFFERENT VAPID key — it must be recreated.'
      );
      if (!matches) {
        await subscription.unsubscribe();
        subscription = null;
      }
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      add('Browser subscription', true, 'Created a new subscription.');
    }
  } catch (err) {
    add('Browser subscription', false, err instanceof Error ? err.message : 'subscribe() was rejected.');
    return stages;
  }

  try {
    await api.post('/push/subscribe', subscription.toJSON());
    add('Saved to server', true, 'The server accepted this subscription.');
  } catch (err) {
    add('Saved to server', false, err instanceof Error ? err.message : 'POST /push/subscribe failed.');
    return stages;
  }

  try {
    const { deviceCount } = await api.get<{ deviceCount: number }>('/push/diagnostics');
    add('Server sees this device', deviceCount > 0, `${deviceCount} device(s) registered on this account.`);
  } catch (err) {
    add('Server sees this device', false, err instanceof Error ? err.message : 'Request failed.');
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
