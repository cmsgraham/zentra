/* eslint-disable no-restricted-globals */
/**
 * Zentra service worker.
 *
 * Strategy:
 *   - App shell: stale-while-revalidate for navigation requests so the user
 *     can open the app offline and see the last UI; if a fresh network is
 *     available, that response is served and the cache updated in the background.
 *   - Static assets (Next.js _next/static/*, fonts, images): cache-first.
 *   - API: stale-while-revalidate ONLY for safe (GET) read endpoints we
 *     whitelist below. Writes (POST/PATCH/DELETE) are never cached and
 *     always require network — failing offline so the UI can show an error.
 *   - Auth endpoints are NEVER cached (cookies / sensitive).
 *
 * Cache versioning: bump CACHE_VERSION to invalidate on deploy.
 */

const CACHE_VERSION = 'v24';
const SHELL_CACHE   = `zentra-shell-${CACHE_VERSION}`;
const STATIC_CACHE  = `zentra-static-${CACHE_VERSION}`;
const API_CACHE     = `zentra-api-${CACHE_VERSION}`;
const OFFLINE_URL   = '/offline.html';
// Routes pre-warmed on SW install so the app loads offline even on first run.
const PRECACHE_ROUTES = [
  '/today',
  '/lists',
  '/planner',
  '/settings',
  '/welcome',
  '/legal/privacy',
  '/legal/terms',
];

const PRECACHE_ASSETS = [
  OFFLINE_URL,
  '/zentra_logo_azul.png',
  '/manifest.webmanifest',
];
// API GET paths we cache (regex). Limit scope tightly to read-only data the
// user might want to glance at offline (shopping lists, tasks, workspaces).
const CACHEABLE_API = [
  /^\/api\/lists(\/|\?|$)/,
  /^\/api\/lists\/[^/]+\/items/,
  /^\/api\/workspaces(\/|\?|$)/,
  /^\/api\/tasks(\/|\?|$)/,
  /^\/api\/auth\/me$/,
  /^\/api\/auth\/passkeys/,
  /^\/api\/friends(\/|\?|$)/,
  /^\/api\/friends\/(requests|sent|shared-tasks)/,
  /^\/api\/focus\//,
  /^\/api\/priority\//,
  /^\/api\/shopping\//,
  /^\/api\/planner/,
  /^\/api\/today/,
  /^\/api\/zentra\//,
];

// Hard-block: never cache anything matching these.
const NEVER_CACHE = [
  /^\/api\/auth\/login/,
  /^\/api\/auth\/signup/,
  /^\/api\/auth\/logout/,
  /^\/api\/auth\/refresh/,
  /^\/api\/auth\/passkey/,
  /^\/api\/auth\/2fa/,
  /^\/api\/auth\/password/,
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell  = await caches.open(SHELL_CACHE);
    const stat   = await caches.open(STATIC_CACHE);
    // Pre-cache offline shell + brand assets (best effort).
    await Promise.all(PRECACHE_ASSETS.map(async (u) => {
      try {
        const res = await fetch(u, { credentials: 'same-origin' });
        if (res && res.ok) await stat.put(u, res.clone());
      } catch {}
    }));
    // Pre-warm app routes so they load offline even before the user visits them.
    await Promise.all(PRECACHE_ROUTES.map(async (u) => {
      try {
        const res = await fetch(u, { credentials: 'same-origin' });
        if (res && res.ok) await shell.put(u, res.clone());
      } catch {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, STATIC_CACHE, API_CACHE]);
    const names = await caches.keys();
    // Drop any non-current cache. We intentionally do NOT migrate old shell
    // entries: prior versions stored post-hydration document.outerHTML
    // which causes React hydration mismatches (#418) when re-served. The
    // install step pre-warms the new shell with fresh SSR HTML.
    await Promise.all(names.map((n) => keep.has(n) ? null : caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'CACHE_PAGE') {
    const { url, html } = event.data;
    if (typeof url === 'string' && typeof html === 'string') {
      caches.open(SHELL_CACHE).then((cache) => {
        const res = new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
        cache.put(url, res);
      });
    }
  }
  if (event.data && event.data.type === 'INVALIDATE_API_CACHE') {
    const prefixes = Array.isArray(event.data.prefixes) ? event.data.prefixes : [];
    const ack = (event.ports && event.ports[0]) || null;
    event.waitUntil((async () => {
      try {
        const cache = await caches.open(API_CACHE);
        if (prefixes.length === 0) {
          // No prefixes given → nuke entire API cache. This is the safe
          // default for mutations whose effect spans namespaces (e.g. a
          // DELETE on /tasks/{id} also affects /workspaces/{id}/tasks lists).
          const keys = await cache.keys();
          await Promise.all(keys.map((k) => cache.delete(k)));
        } else {
          const keys = await cache.keys();
          await Promise.all(keys.map((k) => {
            const path = new URL(k.url).pathname;
            if (prefixes.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'))) {
              return cache.delete(k);
            }
            return null;
          }));
        }
      } finally {
        if (ack) { try { ack.postMessage({ ok: true }); } catch {} }
      }
    })());
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin requests; let the browser handle CDN/cross-origin.
  if (url.origin !== self.location.origin) return;

  // Never cache writes.
  if (req.method !== 'GET') return;

  // Never cache sensitive endpoints.
  if (NEVER_CACHE.some((r) => r.test(url.pathname))) return;

  // RSC payload requests (Next.js client router): /foo/bar?_rsc=abc123.
  // These are NOT navigations (req.mode === 'cors') but failing them offline
  // breaks Next.js link prefetching and forces noisy fallbacks. Cache them in
  // SHELL_CACHE so client-side navigation works offline as long as the route
  // was visited (or hovered/prefetched) while online.
  if (url.searchParams.has('_rsc')) {
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }

  // Navigation: serve cached HTML or fall back to the offline shell. Also
  // catch same-origin GETs that ASK for HTML even if not flagged as a
  // navigation (e.g. CacheVisitedListPage's pre-warm fetch) so they go
  // through navigationHandler and land in SHELL_CACHE.
  const accept = req.headers.get('accept') || '';
  if (req.mode === 'navigate' || (req.destination === '' && accept.includes('text/html'))) {
    event.respondWith(navigationHandler(req));
    return;
  }

  // Manifest: cache-first (its own cache slot under STATIC_CACHE).
  if (url.pathname === '/manifest.webmanifest') {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // Next.js static chunks / images / fonts → cache-first.
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/_next/image') ||
    url.pathname.match(/\.(?:js|css|woff2?|ttf|svg|png|jpg|jpeg|webp|ico|webmanifest)$/i)
  ) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // Whitelisted API GETs → network-first (cache only as offline fallback).
  // Was stale-while-revalidate, but that caused mutations to "not show up"
  // because the next read served pre-mutation cached data while the network
  // refreshed in the background — the user never saw the fresh response
  // unless they refreshed twice. Network-first guarantees online users
  // always see canonical state, while still working offline via cache.
  if (url.pathname.startsWith('/api/') && CACHEABLE_API.some((r) => r.test(url.pathname))) {
    event.respondWith(networkFirst(req, API_CACHE));
    return;
  }
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const ct = (fresh.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('json') || ct.includes('text')) {
        cache.put(req, fresh.clone()).catch(() => {});
      }
    }
    return fresh;
  } catch {
    const cached = await cache.match(req, { ignoreVary: true, ignoreSearch: false });
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline', offline: true }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreVary: true });
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    if (cached) return cached;
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreVary: true, ignoreSearch: false });
  const networkPromise = fetch(req)
    .then((res) => {
      // Cache any successful response (case-insensitive content-type check).
      if (res && res.ok) {
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('json') || ct.includes('text')) {
          cache.put(req, res.clone()).catch(() => {});
        }
      }
      return res;
    })
    .catch(() => null);
  if (cached) {
    // Fire and forget the revalidation.
    networkPromise;
    return cached;
  }
  const fresh = await networkPromise;
  if (fresh) return fresh;
  return new Response(JSON.stringify({ error: 'Offline', offline: true }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function navigationHandler(req) {
  try {
    const fresh = await fetch(req);
    // Cache successful navigations so the user can revisit offline.
    if (fresh && fresh.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    const cache = await caches.open(SHELL_CACHE);
    const url = new URL(req.url);
    // SHELL_CACHE holds BOTH navigation HTML and RSC payloads (?_rsc=...).
    // We must only serve HTML responses for navigations — returning an RSC
    // payload (text/x-component) renders as raw text on screen.
    const isHtmlResponse = (r) => {
      if (!r) return false;
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      return ct.includes('text/html');
    };
    const isHtmlKey = (k) => !new URL(k.url).searchParams.has('_rsc');
    // 1. Exact URL match (same pathname, no _rsc query).
    const keys = await cache.keys();
    for (const k of keys) {
      const ku = new URL(k.url);
      if (ku.pathname === url.pathname && isHtmlKey(k)) {
        const r = await cache.match(k);
        if (isHtmlResponse(r)) return r;
      }
    }
    // 3. Dynamic-route fallback: for an uncached path like /lists/abc,
    //    serve any cached sibling under the same parent (e.g. /lists/xyz).
    //    This works because Next.js App Router renders client pages as a
    //    minimal SSR loading shell — the JS bundle reads the listId from
    //    the URL at runtime and fetches data via api-client (which has its
    //    own localStorage offline cache). All /lists/<*> SSR HTML is
    //    structurally identical, so there's no hydration mismatch.
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length >= 2) {
      const parent = '/' + segments[0] + '/';
      for (const k of keys) {
        const ku = new URL(k.url);
        // Match any cached page sharing the same first segment
        // (e.g. /lists/<other> when /lists/<this> requested).
        if (
          ku.pathname.startsWith(parent) &&
          ku.pathname.split('/').filter(Boolean).length >= 2 &&
          isHtmlKey(k)
        ) {
          const r = await cache.match(k);
          if (isHtmlResponse(r)) {
            // Return the cached HTML directly — browser keeps the requested
            // URL in the address bar (no redirect, no URL rewrite).
            return r;
          }
        }
      }
      // Last resort for known parents: redirect to the parent index so the
      // user at least lands on something rather than the offline page.
      const parentPath = '/' + segments[0];
      const KNOWN_PARENTS = ['/lists', '/planner', '/today', '/friends', '/settings'];
      if (KNOWN_PARENTS.includes(parentPath)) {
        const parentReq = new Request(new URL(parentPath, url.origin).toString());
        const parentCached = await cache.match(parentReq, { ignoreSearch: true });
        if (parentCached) return Response.redirect(parentPath, 302);
      }
    }
    // NOTE: We intentionally do NOT fall back to an arbitrary cached page —
    // serving /friends HTML when the user requested /lists causes wrong-route
    // navigation AND React hydration errors (#418) because the React tree
    // shipped in the JS doesn't match the cached HTML.
    // Instead, show the dedicated offline page.
    const offline =
      (await (await caches.open(STATIC_CACHE)).match(OFFLINE_URL)) ||
      (await cache.match(OFFLINE_URL));
    if (offline) return offline;
    return new Response('You are offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
