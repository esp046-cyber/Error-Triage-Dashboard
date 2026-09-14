/*
  Service worker for "Where Did It Break?"
  Strategy:
  - App shell (HTML/CSS/JS/manifest/icons) -> cache-first, so the installed
    PWA opens instantly and works offline on iOS.
  - Anything else (e.g. future real API calls to a backend) -> network-first,
    falling back to cache if offline.
*/

const CACHE_NAME = "wdib-shell-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET requests; let everything else (future POST retries, etc.) pass through.
  if (request.method !== "GET") return;

  const isAppShellRequest = APP_SHELL.some((path) =>
    request.url.endsWith(path.replace("./", ""))
  ) || request.mode === "navigate";

  if (isAppShellRequest) {
    // Cache-first for the shell.
    event.respondWith(
      caches.match(request).then((cached) => {
        return (
          cached ||
          fetch(request).then((response) => {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            return response;
          })
        );
      })
    );
  } else {
    // Network-first for everything else, with cache fallback.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
  }
});
