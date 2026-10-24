// Service worker: only shows pushed alarms and opens the app on tap. No offline caching (out of scope,
// docs/web-v1-contract.md non-goals); the page always loads fresh prices from the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let note = { title: 'Pumpevakt', body: 'Open the app for details.' };
  try {
    if (event.data) note = { ...note, ...event.data.json() };
  } catch {
    // Not JSON: show the generic text rather than nothing (iOS requires a visible notification per push).
  }
  event.waitUntil(
    self.registration.showNotification(note.title, {
      body: note.body,
      tag: note.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: note.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.location.origin));
      return open ? open.navigate(url).then((c) => c && c.focus()) : self.clients.openWindow(url);
    }),
  );
});
