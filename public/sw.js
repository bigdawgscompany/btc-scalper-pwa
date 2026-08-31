const CACHE_NAME = "btc-scalper-shell-v2";
const SHELL_ASSETS = [
  "/",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

// API routes that must NEVER be cached
const NO_CACHE_PATHS = ["/api/market", "/api/quote", "/api/signal", "/api/klines", "/api/health"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache API routes
  if (NO_CACHE_PATHS.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(fetch(request));
    return;
  }

  // Shell: cache-first strategy
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && request.method === "GET" && url.origin === self.location.origin) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((c) => c.put(request, clone));
      }
      return response;
    }))
  );
});
