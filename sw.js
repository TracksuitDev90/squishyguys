// ── Squishy Fruit — offline cache ───────────────────────────────
// After the first visit the game starts from the local cache: instant
// on a slow or flaky connection, and fully playable offline.
//
// Updates without version bumps: every launch serves the cached game
// straight away, then quietly revalidates every file in the background
// (conditional requests — unchanged files cost a 304, not a download).
// New files are only written once ALL of them have arrived, so a
// launch never mixes old and new modules; the update shows up on the
// next launch.
//
// Keep CORE in sync with what index.html loads. A file missing from
// this list still works (it's cached the first time it's fetched) —
// it just won't be available offline until then.

const CACHE = 'squishy-fruit-v1'; // bump only if the caching scheme changes

const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'fonts/patrick-hand-latin.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'js/vendor/matter.min.js',
  'js/main.js',
  'js/compat.js',
  'js/config.js',
  'js/clock.js',
  'js/physics.js',
  'js/balls.js',
  'js/renderer.js',
  'js/cupart.js',
  'js/particles.js',
  'js/menus.js',
  'js/input.js',
  'js/score.js',
  'js/save.js',
  'js/audio.js',
  'js/music.js',
  'js/song.js',
  'js/store.js',
  'js/skins.js',
  'js/cups.js',
  'js/fever.js',
  'js/perf.js',
];

// Safari refuses to serve a redirected response to a navigation, so
// never store one as-is
function unredirect(res) {
  if (!res.redirected) return res;
  return new Response(res.body, {
    status: res.status, statusText: res.statusText, headers: res.headers,
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 'reload' skips the HTTP cache so the first install is current
    await Promise.all(CORE.map(async (url) => {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (!res.ok) throw new Error(`precache ${url}: ${res.status}`);
      await cache.put(url, unredirect(res));
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// Background refresh, at most once a minute per worker. Only a
// completed refresh starts the cooldown — an attempt made offline must
// not block the next launch's check once the connection is back.
let refreshing = null;
let lastRefresh = 0;

function refreshAll() {
  if (refreshing || Date.now() - lastRefresh < 60000) return refreshing;
  refreshing = (async () => {
    const cache = await caches.open(CACHE);
    const urls = new Set(CORE.map((u) => new URL(u, self.registration.scope).href));
    for (const req of await cache.keys()) urls.add(req.url);
    // All or nothing: if any file fails, keep the current consistent set
    const fresh = await Promise.all([...urls].map(async (url) => {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`refresh ${url}: ${res.status}`);
      return [url, unredirect(res)];
    }));
    await Promise.all(fresh.map(([url, res]) => cache.put(url, res)));
    lastRefresh = Date.now();
  })().catch(() => {}).finally(() => { refreshing = null; });
  return refreshing;
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') {
    cache.put(request, unredirect(res.clone())).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(cacheFirst(request));
  // A launch (page navigation) is the cue to look for an update
  if (request.mode === 'navigate') event.waitUntil(refreshAll());
});
