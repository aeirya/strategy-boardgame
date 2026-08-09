const CACHE_PREFIX = "strategy-boardgame-pwa-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const APP_SHELL = new URL("./", self.location.href).href;
const PRECACHE = [
  APP_SHELL,
  new URL("./manifest.webmanifest", self.location.href).href,
  new URL("./icons/app-icon-180.png", self.location.href).href,
  new URL("./icons/app-icon-512.png", self.location.href).href
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request)
      .then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      })
      .catch(async () => (
        await caches.match(request, { ignoreSearch: true })
        ?? await caches.match(APP_SHELL)
        ?? Response.error()
      )));
    return;
  }

  event.respondWith(caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then(async (response) => {
      if (response.ok && response.type === "basic") {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    });
  }));
});
