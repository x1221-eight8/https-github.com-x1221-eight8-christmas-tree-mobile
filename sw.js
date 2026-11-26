const VERSION = 'christmas-memory-tree-v1';
const CORE = [
  './', './index.html', './styles.css', './app.js', './scene.js', './gestures.js',
  './manifest.webmanifest', './icon.svg',
  './winter.jpg', './lights.jpg', './gift.jpg',
  './three.module.min.js', './vision_bundle.mjs',
  './three.core.min.js',
  './gesture_recognizer.task',
  './vision_wasm_internal.js',
  './vision_wasm_internal.wasm',
  './vision_wasm_nosimd_internal.js',
  './vision_wasm_nosimd_internal.wasm',
];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok && new URL(event.request.url).origin === self.location.origin) {
      const copy = response.clone();
      caches.open(VERSION).then((cache) => cache.put(event.request, copy));
    }
    return response;
  })));
});

