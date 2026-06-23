const API_BASE = '/api';

interface FetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  // When true, allow the cache layer to serve a stale response on network failure.
  // Caller passes through to fetch(); we don't read it directly here.
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  // De-dupe concurrent refreshes
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      return res.ok;
    } catch {
      // Network error during refresh — treat as not-refreshed but don't throw.
      return false;
    }
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

// Tracks whether a recent /auth/refresh cleanly told us "no valid session".
// Only in that case do we redirect to /login on a follow-up 401 — never on a
// network error (which would punt offline users out of their session).
let lastRefreshOutcome: 'ok' | 'unauth' | 'network-error' | null = null;

// --- OFFLINE CACHE: every successful GET is cached so pages can hydrate offline. ---
const OFFLINE_CACHE_KEY = 'zentra:offline-api-cache-v1';
function getOfflineCache() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}
function setOfflineCache(cache: Record<string, any>) {
  try {
    localStorage.setItem(OFFLINE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Quota exceeded — drop oldest half and retry once.
    try {
      const entries = Object.entries(cache).sort(
        (a: any, b: any) => (a[1]?.ts ?? 0) - (b[1]?.ts ?? 0),
      );
      const trimmed = Object.fromEntries(entries.slice(Math.floor(entries.length / 2)));
      localStorage.setItem(OFFLINE_CACHE_KEY, JSON.stringify(trimmed));
    } catch {}
  }
}
function cacheApiResponse(path: string, data: any) {
  const cache = getOfflineCache();
  cache[path] = { data, ts: Date.now() };
  setOfflineCache(cache);
}
function getCachedApiResponse(path: string) {
  const cache = getOfflineCache();
  return cache[path]?.data;
}
// Endpoints that must NEVER return cached data (auth/state-bearing).
const NO_OFFLINE_FALLBACK = [
  /^\/auth\/login/,
  /^\/auth\/signup/,
  /^\/auth\/logout/,
  /^\/auth\/refresh/,
  /^\/auth\/password/,
  /^\/auth\/2fa/,
  /^\/auth\/twofa/,
];
function canFallbackOffline(path: string) {
  return !NO_OFFLINE_FALLBACK.some((re) => re.test(path));
}

export async function api<T = unknown>(path: string, opts: FetchOptions = {}): Promise<T> {
  const { body, headers: extraHeaders, ...rest } = opts;

  const headers: Record<string, string> = { ...extraHeaders as Record<string, string> };
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';

  const serializedBody = body instanceof FormData ? body : body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined;

  const doFetch = () =>
    fetch(`${API_BASE}${path}`, {
      ...rest,
      headers,
      body: serializedBody,
      credentials: 'include',
    });

  const isGet = opts.method === undefined || opts.method === 'GET';
  const fallbackOffline = (): T => {
    const cached = getCachedApiResponse(path);
    if (cached !== undefined) return cached as T;
    // No cache for this safe GET while offline. Return null instead of
    // throwing so callers using Promise.all([...]) don't blow up with an
    // unhandled rejection on first-time-offline visits. Pages that need
    // stricter handling can null-check.
    return null as T;
  };

  // Fast path: when the browser tells us we're offline, skip the network
  // entirely for safe GETs and serve from localStorage. This sidesteps any
  // service-worker cache gaps (e.g. data cached under a previous SW version
  // that got purged on cache-version bump).
  if (
    isGet &&
    canFallbackOffline(path) &&
    typeof navigator !== 'undefined' &&
    navigator.onLine === false
  ) {
    return fallbackOffline();
  }

  let res: Response;
  try {
    res = await doFetch();
  } catch (err) {
    // Network failure (offline, DNS, CORS, etc.).
    if (isGet && canFallbackOffline(path)) return fallbackOffline();
    throw new ApiError(0, (err as Error).message || 'Network unavailable', { offline: true });
  }

  // Service worker intercepts /api/* and, when offline with no SW cache hit,
  // returns a synthetic 503 {error,offline:true}. That looks like a normal
  // response to fetch() (no throw), so we must inspect for the offline flag
  // here and fall back to the localStorage GET cache populated by prior
  // successful online responses.
  if (res.status === 503 && isGet && canFallbackOffline(path)) {
    let offlineFlagged = false;
    try {
      const peek = res.clone();
      const body = await peek.json();
      offlineFlagged = body && body.offline === true;
    } catch {}
    if (offlineFlagged) return fallbackOffline();
  }

  // Paths where a 401 is *legitimate* and must NOT trigger a silent refresh
  // (would otherwise cause loops or mask real auth failures).
  const noRefreshPaths = [
    '/auth/refresh',
    '/auth/login',
    '/auth/signup',
    '/auth/password',
    '/auth/twofa',
    '/auth/2fa',
    '/auth/google',
    '/auth/passkey',
  ];
  const skipRefresh = noRefreshPaths.some((p) => path.startsWith(p));

  // On 401, attempt one silent refresh and retry. This covers /auth/me and
  // every protected endpoint so an expired access token transparently
  // renews via the long-lived refresh cookie without bouncing the user to login.
  if (res.status === 401 && !skipRefresh) {
    let refreshOk = false;
    try {
      refreshOk = await refreshAccessToken();
      lastRefreshOutcome = refreshOk ? 'ok' : 'unauth';
    } catch {
      lastRefreshOutcome = 'network-error';
    }
    if (refreshOk) {
      try {
        res = await doFetch();
      } catch (err) {
        throw new ApiError(0, (err as Error).message || 'Network unavailable', { offline: true });
      }
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    // Session truly gone — bounce to /login. ONLY when refresh confirmed unauth
    // (not when it failed due to network, which is just an offline blip).
    if (
      res.status === 401 &&
      !skipRefresh &&
      lastRefreshOutcome === 'unauth' &&
      typeof window !== 'undefined' &&
      navigator.onLine !== false
    ) {
      const here = window.location.pathname;
      if (here !== '/login' && here !== '/signup' && here !== '/welcome') {
        window.location.replace('/login');
      }
    }
    throw new ApiError(res.status, err.message ?? 'Request failed');
  }
  if (res.status === 204) {
    await invalidateSwApiCache(path, isGet);
    return undefined as T;
  }
  const data = await res.json();
  // Cache successful GET responses for offline use.
  if (isGet && canFallbackOffline(path)) {
    try { cacheApiResponse(path, data); } catch {}
  }
  await invalidateSwApiCache(path, isGet);
  return data;
}

// After a successful mutation, evict cached GET responses so the next read
// returns fresh data instead of a stale-while-revalidate hit.
//
// We deliberately nuke the entire service-worker API cache (and the
// localStorage offline cache) rather than trying to scope by prefix. A DELETE
// on /tasks/{id} affects list endpoints under unrelated namespaces (e.g.
// /workspaces/{id}/tasks, /today, /planner/...), and prefix-based eviction
// missed those — which is exactly why deleted intentions kept reappearing
// and re-deleting them returned "not found".
//
// We clear caches DIRECTLY from the page via the Cache Storage API so this
// works even when the user's browser is still controlled by an older SW
// version (common on iOS / installed PWAs where the SW updates lazily).
async function invalidateSwApiCache(path: string, isGet: boolean): Promise<void> {
  if (isGet) return;
  // Drop the localStorage GET cache so offline reloads can't resurrect
  // the deleted/edited row.
  try { localStorage.removeItem(OFFLINE_CACHE_KEY); } catch {}
  // Directly delete every entry from any zentra-api-* cache. This bypasses
  // the SW message handler entirely so it works regardless of SW version.
  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith('zentra-api-'))
          .map(async (n) => {
            const cache = await caches.open(n);
            const keys = await cache.keys();
            await Promise.all(keys.map((k) => cache.delete(k)));
          }),
      );
    }
  } catch {}
  // Also notify the active SW (newer versions ack; older just ignore the ack).
  try {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    const ctrl = sw && sw.controller;
    if (ctrl) ctrl.postMessage({ type: 'INVALIDATE_API_CACHE', prefixes: [] });
  } catch {}
}

export class ApiError extends Error {
  public offline: boolean;
  constructor(public status: number, message: string, opts?: { offline?: boolean }) {
    super(message);
    this.name = 'ApiError';
    this.offline = opts?.offline ?? false;
  }
}
