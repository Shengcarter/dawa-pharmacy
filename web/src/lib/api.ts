/**
 * API client. The access token lives in memory only; the refresh token is an
 * HttpOnly cookie the browser sends to /api/auth. A 401 triggers one shared
 * refresh attempt, then the request is retried once.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public details?: unknown,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export const setSessionLostHandler = (fn: () => void) => {
  onSessionLost = fn;
};

const CLIENT_HEADER = { 'X-Dawa-Client': 'web' };

async function parseError(res: Response): Promise<ApiError> {
  let body: { error?: { code?: string; message?: string; fields?: Record<string, string>; details?: unknown } } = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error */
  }
  const e = body.error ?? {};
  const fallback = res.status >= 500 ? 'The server had a problem. Please try again.' : `Request failed (${res.status}).`;
  return new ApiError(res.status, e.code ?? 'ERROR', e.message ?? fallback, e.fields, e.details);
}

export async function refreshSession(): Promise<{ accessToken: string; user: unknown } | null> {
  const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin', headers: CLIENT_HEADER });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.accessToken) return null;
  accessToken = data.accessToken;
  return data;
}

async function tryRefresh(): Promise<boolean> {
  refreshing ??= refreshSession()
    .then((r) => Boolean(r))
    .finally(() => {
      setTimeout(() => {
        refreshing = null;
      }, 0);
    });
  return refreshing;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function withQuery(path: string, query?: Query) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = { ...CLIENT_HEADER };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check the connection and try again.');
  }
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await tryRefresh()) return request<T>(method, path, body, false);
    onSessionLost?.();
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', withQuery(path, query)),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  delete: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<T>('POST', path, form);
  },
};

/** Downloads a protected file (CSV export, receipt attachment, backup) with the current session. */
export async function downloadFile(path: string, query?: Query, fallbackName = 'download') {
  const url = `/api${withQuery(path, query)}`;
  const go = () =>
    fetch(url, { headers: { ...CLIENT_HEADER, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, credentials: 'same-origin' });
  let res = await go();
  if (res.status === 401 && (await tryRefresh())) res = await go();
  if (!res.ok) throw await parseError(res);
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** Opens a protected file in a new tab (e.g. an expense receipt image/PDF). */
export async function openProtectedFile(path: string) {
  const res = await fetch(`/api${path}`, { headers: { ...CLIENT_HEADER, Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw await parseError(res);
  const blob = await res.blob();
  window.open(URL.createObjectURL(blob), '_blank', 'noopener');
}

export const authApi = {
  login: (email: string, password: string) =>
    request<{ accessToken: string; user: unknown }>('POST', '/auth/login', { email, password }, false),
  logout: () => request<void>('POST', '/auth/logout', {}, false),
};
