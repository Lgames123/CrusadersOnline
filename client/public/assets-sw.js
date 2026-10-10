// Serves /generated/* (assets converted in this browser from the player's own installation,
// stored in Cache Storage by the import worker) with the same URLs the development server uses.
// Cache misses fall through to the network (the dev server's local/generated middleware).
const CACHE = 'crusaders-generated';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith('/generated/')) return;
  event.respondWith(
    caches.open(CACHE)
      .then((cache) => cache.match(url.pathname))
      .then((hit) => hit || fetch(event.request)),
  );
});
