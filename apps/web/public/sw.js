/* RepoWrangler service worker — PWA groundwork (goal 7 / FR-011).
   App-shell + static-asset caching for installability and offline shell.
   Provider data is never cached: /api, /auth, /webhooks, /health, /setup are
   always network. */
const CACHE = 'repo-wrangler-shell-v2';
const SHELL = ['/', '/lasso.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (/^\/(api|auth|webhooks|health|setup)\//.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/')));
    return;
  }

  event.respondWith(
    caches.match(request).then(async (cached) => {
      if (cached) return cached;
      const response = await fetch(request);
      // Never make a transient 404/500, truncated response, or redirect into a
      // permanent application failure. Vite assets are content-hashed, so only
      // a complete successful response is safe to retain cache-first.
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        void caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    }),
  );
});
