import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from './client';

export interface User {
  id: string;
  email: string;
}

interface AuthResponse {
  user: User;
}

// Session check (attempt-and-catch-401): the JWT lives in an httpOnly cookie
// this app can never read directly, so "am I logged in" is answered by
// calling a real protected endpoint and treating a 401 as "no". No dedicated
// /auth/me endpoint exists on the backend — deliberate, see Architecture.md
// Section 1 / the Phase 3 plan.
export function useSession() {
  return useQuery<User | null>({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        const { portfolios } = await apiFetch<{ portfolios: unknown[] }>('/portfolios');
        void portfolios;
        return readCachedUser();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: Infinity,
  });
}

// /portfolios only proves "a valid session exists," it doesn't return the
// user's own identity — signup/login responses do, so we cache that locally
// (not localStorage; a real session boundary is still whatever the httpOnly
// cookie says, this is just a display convenience for e.g. "signed in as").
let cachedUser: User | null = null;
function readCachedUser() {
  return cachedUser;
}

export function useSignup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => apiFetch<AuthResponse>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    onSuccess: ({ user }) => {
      cachedUser = user;
      queryClient.setQueryData(['session'], user);
    },
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => apiFetch<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    onSuccess: ({ user }) => {
      cachedUser = user;
      queryClient.setQueryData(['session'], user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ success: true }>('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      cachedUser = null;
      queryClient.setQueryData(['session'], null);
      queryClient.clear();
    },
  });
}
