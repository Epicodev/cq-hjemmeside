// Minimal offline cache for the ferie-udgifter app.
// Bump CACHE when any of the precached files change to force an update.
var CACHE = "ferie-v1";
var ASSETS = ["./", "./index.html", "./manifest.json", "./icon.svg"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  // Network-first for the app shell so updates land, cache as offline fallback.
  e.respondWith(
    fetch(e.request)
      .then(function (res) {
        if (res && res.ok && e.request.url.indexOf("http") === 0) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      })
      .catch(function () { return caches.match(e.request).then(function (m) { return m || caches.match("./index.html"); }); })
  );
});
