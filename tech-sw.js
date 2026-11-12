// Alpine tech app: keeps the My Visits screen opening with no signal (basements, rooftops).
// Only the files listed here are cached, network first; every other portal page is left alone.
// Visit data is not cached here: Firestore keeps its own copy and queues saves (see ap-firebase.js).
const CACHE = "alpine-tech-v1";
const FILES = ["tech.html", "tech-app.js", "auth.js", "ap-firebase.js", "tech.webmanifest", "images/tech-icon-192.png"];
const FB = /^https:\/\/www\.gstatic\.com\/firebasejs\//;
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("alpine-tech-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  const mine = u.origin === location.origin && FILES.some(f => u.pathname.endsWith("/" + f));
  if (!mine && !FB.test(e.request.url)) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
