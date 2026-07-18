/* RepoWrangler service worker — PWA groundwork (goal 7 / FR-011).
   Static-asset caching for installability without caching the application
   shell. The same localhost origin is reused across immutable deployments, so
   retaining '/' can resurrect an obsolete UI during first boot.
   Provider data is never cached: /api, /auth, /webhooks, /health, /setup are
   always network. */
const CACHE = 'repo-wrangler-static-v3';
const STATIC = ['/lasso.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(STATIC))
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
    // Navigation must always use the currently deployed application shell.
    // A failed boot remains a visible network failure instead of silently
    // loading a stale Command Center from a previous deployment.
    event.respondWith(fetch(request));
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
