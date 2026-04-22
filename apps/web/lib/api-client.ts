const API_BASE = '/api';

interface FetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  token?: string;
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('zentra_refresh');
  if (!refreshToken) return null;
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    localStorage.removeItem('zentra_token');
    localStorage.removeItem('zentra_refresh');
    return null;
  }
  const data = await res.json();
  localStorage.setItem('zentra_token', data.accessToken);
  localStorage.setItem('zentra_refresh', data.refreshToken);
  return data.accessToken;
}

export async function api<T = unknown>(path: string, opts: FetchOptions = {}): Promise<T> {
  const { body, token, headers: extraHeaders, ...rest } = opts;
  const accessToken = token ?? (typeof window !== 'undefined' ? localStorage.getItem('zentra_token') : null);

  const headers: Record<string, string> = { ...extraHeaders as Record<string, string> };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';

  const serializedBody = body instanceof FormData ? body : body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined;

  let res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers,
    body: serializedBody,
  });

  if (res.status === 401 && accessToken) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      res = await fetch(`${API_BASE}${path}`, {
        ...rest,
        headers,
        body: serializedBody,
      });
    }
  }

  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
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
