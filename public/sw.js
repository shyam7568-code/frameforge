const CACHE = 'frameforge-v2';
const SHELL = ['./', './index.html', './paint.html', './manifest.webmanifest', './paint.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];
const MODEL_HOSTS = ['cdn.jsdelivr.net', 'storage.googleapis.com'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('frameforge-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) caches.open(CACHE).then(cache => cache.put(req, res.clone()));
          return res.clone();
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html'))),
    );
    return;
  }
  if (MODEL_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(req).then(
        hit =>
          hit ||
          fetch(req).then(res => {
            if (res.ok) caches.open(CACHE).then(cache => cache.put(req, res.clone()));
            return res.clone();
          }),
      ),
    );
  }
});
