// Service worker. Cache-first for the app shell — the HTML, CSS, JS,
// manifest and icons. Nothing else is ever fetched (no CDN, no API calls,
// no external resources — see the spec's own constraints), so there is no
// other network strategy to design here.
//
// This worker must never cache or touch IndexedDB. The 2 are unrelated:
// this file holds the app; IndexedDB (db.js) holds the data. A cache
// purge below only ever removes old copies of the app shell, never data.

// THIS IS THE SINGLE BIGGEST TRAP IN THE PROJECT. If this isn't bumped on
// every deploy, the phone keeps serving the OLD cached code after a push,
// and it looks exactly as though the change did nothing at all. Bump past
// every value ANY branch has ever used — not just +1 from main — checked
// via `git log --all -p -- sw.js` across every branch (deleted ones too,
// as far as still-reachable history goes), since 2 sibling branches once
// each bumped "v1" to "v2" independently and ended up byte-identical,
// which meant a phone that had cached either one's service worker never
// noticed the other was different after a Pages source-branch switch.
// Every value used anywhere so far: v1 (main), v2 (an abandoned branch,
// since deleted), v3 and v4 (another since-superseded branch) — so v5.
const CACHE_VERSION = "v5";
const CACHE_NAME = `jewelry-shell-${CACHE_VERSION}`;

const APP_SHELL = [
  "./",
  "index.html",
  "css/app.css",
  "js/db.js",
  "js/photos.js",
  "js/backup.js",
  "js/app.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting(); // don't make the user close every tab for a bumped version to take effect
});

// Delete every cache whose name doesn't match the current version — this
// is what actually makes bumping CACHE_VERSION above do anything.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
