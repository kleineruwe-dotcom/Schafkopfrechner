// Offline-Cache für Schafkopfrechner: App-Dateien aus dem Cache, Daten immer frisch vom Server.
const CACHE = "schafkopfrechner-v2";
const FILES = ["./", "index.html", "style.css", "app.js", "scoring.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "parkcafe-logo.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.includes("/api/")) return;
  // Netz zuerst (damit Updates sofort ankommen), Cache als Rückfall.
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
