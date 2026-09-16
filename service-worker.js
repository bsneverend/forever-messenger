const CACHE_NAME = "forever-shell-v10";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=preview-controls-3",
  "./app.js?v=preview-controls-3",
  "./notification.js?v=push-1",
  "./realtime-fix.js?v=live-1",
  "./manifest.json",
  "./assets/icon-192.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text?.() || "New message" };
  }

  const title = payload.title || "Forever";
  const options = {
    body: payload.body || "New message",
    icon: "./assets/icon-192.png",
    badge: "./assets/icon-192.png",
    tag: payload.tag || "forever-message",
    renotify: true,
    data: {
      url: payload.url || "./",
      conversationId: payload.conversationId || null,
      messageId: payload.messageId || null
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "./", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        return existing.focus().then(() => existing.navigate(targetUrl));
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

// Network-first keeps new Forever versions fresh.
// If the user is offline, the previously cached app shell is used.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.hostname.endsWith(".supabase.co")) return;
  if (requestUrl.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
