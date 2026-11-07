/* Service worker de Manager.
   Pour publier une nouvelle version : changer le numéro ci-dessous. */
const VERSION = 'manager-v2-2';

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'vendor/tailwind.css',
  'vendor/react.production.min.js',
  'vendor/react-dom.production.min.js',
  'vendor/htm.umd.js',
  'vendor/jspdf.umd.min.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Page : le réseau d'abord (nouvelle version), mais jamais plus de 2,5 s d'attente, sinon le cache.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await Promise.race([
          fetch(req),
          new Promise((_, reject) => setTimeout(() => reject(new Error('lent')), 2500))
        ]);
        if (res && res.ok) cache.put('index.html', res.clone());
        return res;
      } catch (_) {
        return (await cache.match('index.html')) || Response.error();
      }
    })());
    return;
  }

  // Fichiers de l'app : le cache d'abord.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
      }
      return res;
    }))
  );
});
