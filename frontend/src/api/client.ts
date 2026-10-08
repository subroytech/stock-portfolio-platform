import { clearSession, queryClient } from '../lib/queryClient';

// Every call goes through here so credentials:'include' (the httpOnly
// auth_token cookie) and JSON handling are never duplicated per-call-site.
// Backend defaults to localhost:4000 (backend/src/config/env.ts); override
// via VITE_API_BASE_URL for anything else (staging, etc.).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const message = (body as { error?: string } | null)?.error ?? `Request failed with status ${res.status}`;
    // 401 = requireAuth's own contract: missing/invalid/expired token, never "valid session,
    // wrong permission" (that's a 403, untouched here). Self-heals a stale cached session
    // (see clearSession's own comment) instead of leaving the app silently failing until a
    // manual refresh.
    if (res.status === 401) clearSession(queryClient, { markExpired: true });
    throw new ApiError(res.status, message, body);
  }

  return body as T;
}
