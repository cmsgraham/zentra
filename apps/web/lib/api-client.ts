const API_BASE = '/api';

interface FetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  // De-dupe concurrent refreshes
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    return res.ok;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export async function api<T = unknown>(path: string, opts: FetchOptions = {}): Promise<T> {
  const { body, headers: extraHeaders, ...rest } = opts;

  const headers: Record<string, string> = { ...extraHeaders as Record<string, string> };
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';

  const serializedBody = body instanceof FormData ? body : body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined;

  let res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers,
    body: serializedBody,
    credentials: 'include',
  });

  // On 401, attempt one silent refresh and retry
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const ok = await refreshAccessToken();
    if (ok) {
      res = await fetch(`${API_BASE}${path}`, {
        ...rest,
        headers,
        body: serializedBody,
        credentials: 'include',
      });
    }
  }

  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    // Session truly gone — bounce to /login (skip for /auth/* calls which are
    // allowed to return 401 during normal flow, e.g. loadUser on boot).
    if (res.status === 401 && !path.startsWith('/auth/') && typeof window !== 'undefined') {
      const here = window.location.pathname;
      if (here !== '/login' && here !== '/signup' && here !== '/welcome') {
        window.location.replace('/login');
      }
    }
    throw new ApiError(res.status, err.message ?? 'Request failed');
  }
  return res.json();
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
