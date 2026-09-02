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
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          // Focus alone would leave the user on whatever page they last had
          // open; navigate so a tapped reminder actually lands somewhere useful.
          if ('navigate' in client) client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
