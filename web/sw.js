// Keeps the browser version of FocusQuest working offline.
// The cached copy is shown at once; a newer one is fetched in the background and used on the next start.
const CACHE = 'focusquest-1';
const FILES = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req, { cache: 'no-cache' }).then(r => { if (r.ok) cache.put(req, r.clone()); return r; });
    if (cached) { e.waitUntil(fresh.catch(() => {})); return cached; }
    return fresh;
  })());
});
