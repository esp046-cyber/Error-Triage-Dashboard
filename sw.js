/*
  Service worker for "Where Did It Break?"
  Strategy:
  - App shell (HTML/CSS/JS/manifest/icons) -> cache-first, so the installed
    PWA opens instantly and works offline on iOS.
  - Anything else (e.g. real API calls to your n8n backend) -> network-first,
    falling back to cache if offline.
  - Web Push: receives push events sent by the get-errors n8n workflow and
    shows a native iOS notification (Safari 16.4+, installed PWA only).
*/

const CACHE_NAME = "wdib-shell-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
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

/* ==========================================================================
   WEB PUSH
   The get-errors n8n workflow sends a JSON payload like:
     { "title": "Where Did It Break?", "body": "Acme Corp: HubSpot rate limit exceeded", "url": "./" }
   via the Web Push protocol using the VAPID key pair from SETUP.md.
   ========================================================================== */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { body: event.data ? event.data.text() : "A workflow failed." };
  }

  const title = data.title || "Where Did It Break?";
  const options = {
    body: data.body || "A workflow failed — tap to view.",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    data: { url: data.url || "./" }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : "./";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
