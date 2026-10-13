import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

export const SESSION_EXPIRED_STORAGE_KEY = 'sessionExpired';

// Clears the cached session - shared by an explicit Log out (api/auth.ts's useLogout) and by
// apiFetch's global 401 handling (api/client.ts), so both take the same two-step path:
// 1. setQueryData(['session'], null) FIRST - this alone makes ProtectedRoute redirect to
//    /login and unmount the entire authenticated tree on its very next render. Session ends
//    up "present but null," not missing, so useSession() itself has no reason to refetch
//    either.
// 2. clear() deferred past that render/commit via setTimeout(0) - by the time it runs,
//    everything that used to be mounted (portfolios, roles, whatever tab was open) has
//    already unmounted and is no longer an active observer, so removing their cached data
//    doesn't trigger a refetch for any of them.
//
// `markExpired: true` additionally flags sessionStorage, but ONLY if a real session was
// cached at the moment of the call - this is what distinguishes "you were logged in and just
// got kicked out mid-session" (LoginPage shows a banner) from a plain first-ever visit or a
// failed login/signup attempt (both start from a null session already, so never set the flag).
//
// Takes the QueryClient explicitly rather than closing over the singleton above - useLogout
// (a hook, has React context) passes its own useQueryClient() result, same instance tests
// already construct per-render via QueryClientProvider; apiFetch (a plain function, no
// context available) passes the singleton directly, which is what App.tsx wires into the
// real app's own QueryClientProvider - the same object in production either way.
export function clearSession(client: QueryClient, options: { markExpired?: boolean } = {}) {
  if (options.markExpired && client.getQueryData(['session'])) {
    try { sessionStorage.setItem(SESSION_EXPIRED_STORAGE_KEY, '1'); } catch { /* private browsing/quota */ }
  }
  client.setQueryData(['session'], null);
  setTimeout(() => {
    client.clear();
    client.setQueryData(['session'], null);
  }, 0);
}
