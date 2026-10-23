// Impact Event Ops service worker: shows push notifications and opens the app when one is tapped.
// It deliberately does not cache the app, so updates reach everyone immediately.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Impact Event Ops', {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    icon: '/api/app-icon?size=192', // the App settings icon (falls back to the built-in one)
    badge: '/icons/badge-72.png',
    data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(w => new URL(w.url).origin === self.location.origin);
    if (open) {
      open.postMessage({ type: 'open', url });
      return open.focus();
    }
    return self.clients.openWindow(url);
  })());
});
