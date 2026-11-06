// Kall Konnect service worker — handles Web Push delivery and notification
// clicks, and satisfies the browser's PWA installability requirements (an
// active service worker with a fetch handler). Registered unconditionally
// on page load from src/main.tsx. Still does no offline caching — fetch is
// a pure pass-through to the network.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // No-op: required so the browser recognizes this as a "real" service
  // worker for install-prompt purposes. Everything still goes to network.
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Kall Konnect', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Kall Konnect';
  const options = {
    body: data.body || '',
    // favicon.ico is 16/32px and renders as a blurry smudge in the Android
    // notification shade. icon-192 is the maskable app icon.
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    // Collapses repeat reminders about the same person rather than stacking
    // them. Without a tag, a week away from the phone means seven separate
    // notifications to swipe.
    tag: data.tag,
    renotify: Boolean(data.tag),
    data: { url: data.url || '/', ...(data.data || {}) },
    // Lock-screen buttons, for reminders about a person: "Call now" and
    // "Remind me tomorrow". Browsers that don't support actions ignore this.
    actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : undefined,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/** Brings the app forward on `url`: reuses an open window if there is one
 * (navigating it, so the tap lands somewhere useful) or opens a new one. */
function openApp(url) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
    for (const client of clientList) {
      if (client.url.includes(self.location.origin) && 'focus' in client) {
        if ('navigate' in client) client.navigate(url).catch(() => {});
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  });
}

/** "Remind me tomorrow" without opening the app: a POST to the signed URL
 * the server put in the push (lib/actionTokens.js). If that isn't
 * available or fails, open the app, which offers the same thing. */
function snooze(data) {
  if (!data.snoozeUrl) return openApp(data.snoozeAppUrl || data.url || '/');
  return fetch(data.snoozeUrl, { method: 'POST', mode: 'cors', credentials: 'omit' })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return self.registration.showNotification('Got it', {
        body: "We'll remind you tomorrow.",
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'kk-snoozed',
        silent: true,
      });
    })
    .catch(() => openApp(data.snoozeAppUrl || data.url || '/'));
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  if (event.action === 'snooze') {
    event.waitUntil(snooze(data));
    return;
  }
  // "Call now" opens the person's page ready to dial: placing a call needs
  // a page in front, so it can't happen from the service worker itself.
  const target = event.action === 'call' ? data.callUrl || data.url : data.url;
  event.waitUntil(openApp(target || '/'));
});
