import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from './client';

export interface User {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
  // "Login-as" (CLAUDE.md's "Login-as" section) - true only while the current session is an
  // admin-master impersonating this user. Everything else about `User` (email/roles/
  // permissions) already reflects the impersonated identity, not the real admin's own.
  // Added here (Session/Persona commit) rather than in the later Login-as commit, since
  // UserPersonaBadge.test.tsx's User fixture already needs it - keeps every commit compiling.
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
    onSuccess: () => {
      // Two-step, in this order, to dodge two different races with the same root cause:
      // "an active query observer sees its cached data disappear and immediately refetches
      // with the now-cleared auth cookie," producing a real (if usually harmless) 401.
      //
      // 1. setQueryData(['session'], null) FIRST - this alone makes ProtectedRoute redirect
      //    to /login and unmount the entire authenticated tree (Dashboard's /portfolios
      //    query included) on its very next render. Session ends up "present but null," not
      //    missing, so useSession() itself has no reason to refetch either.
      // 2. clear() deferred past that render/commit via setTimeout(0) - by the time it runs,
      //    everything that used to be mounted (portfolios, users, roles, whatever tab was
      //    open) has already unmounted and is no longer an active observer, so removing
      //    their cached data doesn't trigger a refetch for any of them. Re-affirming session
      //    as null right after clear() is belt-and-suspenders in case anything still mounted
      //    (e.g. a future useSession() call from LoginPage) re-subscribes in that instant.
      queryClient.setQueryData(['session'], null);
      setTimeout(() => {
        queryClient.clear();
        queryClient.setQueryData(['session'], null);
      }, 0);
    },
  });
}
