import { api } from './api';

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) bytes[i] = rawData.charCodeAt(i);
  return bytes;
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

  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  try {
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

function sameKey(current: ArrayBuffer, serverKeyBase64: string): boolean {
  const expected = urlBase64ToUint8Array(serverKeyBase64) as Uint8Array;
  const actual = new Uint8Array(current);
  if (actual.length !== expected.length) return false;
  return actual.every((byte, i) => byte === expected[i]);
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
