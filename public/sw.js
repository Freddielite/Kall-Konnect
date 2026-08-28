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
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: { url: data.url || '/' },
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
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
