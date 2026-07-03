// JWordSearch service worker
// Caching strategy:
//   - Same-origin files (index.html, manifest.json): NETWORK-FIRST — always
//     checks the server for updates first, falls back to cache when offline.
//     This means any change to index.html is picked up immediately without
//     needing to bump CACHE_VERSION.
//   - External GitHub-hosted assets (sounds, banners, icons): CACHE-FIRST —
//     served from cache when available; only hits the network on a miss.
//     These rarely change so this keeps load times fast.
// Bump CACHE_VERSION if you need to force-evict old cached external assets.
const CACHE_VERSION = 'jwordsearch-v2';

// App shell: same-origin files this page needs to run.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
];

// External assets hosted on GitHub Pages — sounds, banners, and icons.
// These rarely change, so they're cached aggressively (cache-first).
const EXTERNAL_ASSETS = [
  'https://chenguibe.github.io/JWordSearch/SOUND_CORRECT.mp3',
  'https://chenguibe.github.io/JWordSearch/SOUND_WRONG.mp3',
  'https://chenguibe.github.io/JWordSearch/SOUND_COMPLETE.mp3',
  'https://chenguibe.github.io/JWordSearch/SOUND_HIGHSCORE.mp3',
  'https://chenguibe.github.io/JWordSearch/SOUND_CLEAR.mp3',
  'https://chenguibe.github.io/JWordSearch/TOP_BANNER.jpeg',
  'https://chenguibe.github.io/JWordSearch/BOTTOM_BANNER.jpeg',
  'https://chenguibe.github.io/JWordSearch/icon192.png',
  'https://chenguibe.github.io/JWordSearch/icon512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // Same-origin files: a normal cache.addAll is fine here.
      const sameOrigin = cache.addAll(APP_SHELL);

      // Cross-origin files: fetched individually with mode 'no-cors'.
      // GitHub Pages doesn't send permissive CORS headers for arbitrary
      // file types, so a regular cross-origin fetch can fail to cache.
      // 'no-cors' mode produces an "opaque" response — we can't inspect
      // its status, but it can still be cached and served back to <img>/
      // <audio> elements, which is all we need here. (Since we've already
      // confirmed these exact URLs are live, the opacity tradeoff is safe.)
      const crossOrigin = Promise.all(
        EXTERNAL_ASSETS.map((url) =>
          fetch(url, { mode: 'no-cors' })
            .then((res) => cache.put(url, res))
            .catch((err) => console.warn('SW: failed to precache', url, err))
        )
      );

      return Promise.all([sameOrigin, crossOrigin]);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests; let everything else pass through untouched.
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isExternalAsset = EXTERNAL_ASSETS.includes(event.request.url);

  if (isSameOrigin) {
    // NETWORK-FIRST for same-origin files (index.html, manifest.json, sw.js).
    // Always tries the server first so any update to index.html is picked up
    // immediately — the cached copy is only used as a fallback when offline.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Update the cache with the fresh copy for offline use.
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline — serve from cache if we have it, otherwise 503.
          return caches.match(event.request).then((cached) =>
            cached ||
            new Response('Offline and this resource is not cached yet.', {
              status: 503,
              statusText: 'Offline',
            })
          );
        })
    );
  } else if (isExternalAsset) {
    // CACHE-FIRST for external GitHub-hosted assets (sounds, banners, icons).
    // These rarely change and are expensive to re-fetch on every load, so we
    // serve from cache when available and only go to the network on a miss.
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request, { mode: 'no-cors' })
          .then((response) => {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
            return response;
          })
          .catch(() =>
            new Response('Offline and this asset is not cached yet.', {
              status: 503,
              statusText: 'Offline',
            })
          );
      })
    );
  }
  // Any other request (e.g. Google Fonts) — fall through, no SW involvement.
});