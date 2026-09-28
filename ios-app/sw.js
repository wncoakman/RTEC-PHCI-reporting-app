/*
 * RTEC PHC Field Reporting — service worker.
 *
 * Precaches the entire app shell (including the vendored pdf-lib) on
 * install so the app opens and works with zero network at all after the
 * first successful load. Cache-first at fetch time, with a network
 * fallback that backfills the cache — and a same-origin-only guard so the
 * SW never tries to intercept a cross-origin request.
 *
 * Bump CACHE_VERSION whenever any shipped file changes, so returning
 * technicians pick up the update on next launch instead of running stale
 * cached code indefinitely.
 */
const CACHE_VERSION = 'phc-field-v4';

const PRECACHE_URLS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'config.js',
  'db.js',
  'phc-logic.js',
  'pdf-report.js',
  'vendor/pdf-lib.min.js',
  'assets/logo.jpg',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          if (req.mode === 'navigate') return caches.match('index.html');
          return undefined;
        });
    })
  );
});
