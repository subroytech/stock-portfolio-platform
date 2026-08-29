import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from './client';
import { clearSession } from '../lib/queryClient';

export interface User {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
  // "Login-as" (CLAUDE.md's "Login-as" section) - true only while the current session is an
  // admin-master impersonating this user. Everything else about `User` (email/roles/
  // permissions) already reflects the impersonated identity, not the real admin's own.
  impersonating: boolean;
}

// Any one of these implies real Admin Console capability. Checking permissions rather than a
// hardcoded roles.includes('admin') role-name check is what makes a superset role like
// admin-master (holds every one of these without literally being named "admin") get the same
// "Admin" link/route access automatically - found live: admin-master saw a plain "API Keys"
// button instead of "Admin", and typing /admin directly would have redirected them away.
const ADMIN_CONSOLE_PERMISSIONS = ['roles:manage', 'permissions:manage', 'users:manage_roles', 'functions:manage'];

export function hasAdminConsoleAccess(session: User | null | undefined): boolean {
  return session?.permissions?.some((p) => ADMIN_CONSOLE_PERMISSIONS.includes(p)) ?? false;
}

// GET /auth/me (backend/src/controllers/auth.controller.ts's `me`, added
// 2026-07-31 - Architecture.md Section 3 item 6) fixed a real pre-existing
// gap: this used to probe /portfolios and catch 401 to infer "logged in",
// caching the user object in a page-load-scoped JS variable that reset on
// every reload. Now a real endpoint returns identity + roles directly, and
// survives a reload like any other query.
export function useSession() {
  return useQuery<User | null>({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        return await apiFetch<User>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: Infinity,
  });
}

// signup/login's own responses don't include roles (the backend keeps that
// User shape deliberately minimal) - chaining a /auth/me call right after
// resolves the mutation with the FULL session (roles included), so
// setQueryData below can populate ['session'] synchronously before the
// caller navigates. Using invalidateQueries instead would only kick off a
// background refetch, leaving a stale/null session for one render - long
// enough for ProtectedRoute to flash back to /login before it resolves.
async function loginAndFetchSession(path: '/auth/signup' | '/auth/login', input: { email: string; password: string }): Promise<User> {
  await apiFetch<{ user: { id: string; email: string } }>(path, { method: 'POST', body: JSON.stringify(input) });
  return apiFetch<User>('/auth/me');
}

export function useSignup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => loginAndFetchSession('/auth/signup', input),
    onSuccess: (user) => queryClient.setQueryData(['session'], user),
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => loginAndFetchSession('/auth/login', input),
    onSuccess: (user) => queryClient.setQueryData(['session'], user),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ success: true }>('/auth/logout', { method: 'POST' }),
    // No markExpired - a deliberate Log out never shows LoginPage's "your session ended"
    // banner, unlike apiFetch's own global 401 handling (see lib/queryClient.ts's
    // clearSession, which this shares with).
    onSuccess: () => clearSession(queryClient),
  });
}

// "Login-as" (CLAUDE.md's "Login-as" section, users:impersonate - admin-master only). Unlike
// clearSession's deferred two-step (built to dodge a stale-observer-refetches-a-dead-cookie
// race on logout), there's no such race here - the new cookie is already valid by the time this
// runs, so wiping every cached query and immediately seeding the new identity just makes any
// still-mounted observer (e.g. Dashboard's portfolios list) correctly refetch as the new user,
// not error.
function switchIdentity(queryClient: ReturnType<typeof useQueryClient>, user: User) {
  queryClient.clear();
  queryClient.setQueryData(['session'], user);
}

export function useImpersonate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => apiFetch<User>('/auth/impersonate', { method: 'POST', body: JSON.stringify({ userId }) }),
    onSuccess: (user) => switchIdentity(queryClient, user),
  });
}

export function useStopImpersonating() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<User>('/auth/stop-impersonating', { method: 'POST' }),
    onSuccess: (user) => switchIdentity(queryClient, user),
  });
}
