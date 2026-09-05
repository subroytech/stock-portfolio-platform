import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export type UserStatus = 'active' | 'deactivated' | 'cancelled' | 'pending';

export interface UserWithRoles {
  id: string;
  email: string;
  roles: string[];
  apiKeyProviders: string[];
  status: UserStatus;
}

// GET /users (backend/src/routes/users.routes.ts, requirePermission('users:manage_roles')) -
// backs UserRolesPage (Admin Console Phase 2).
export function useUsersWithRoles() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<{ users: UserWithRoles[] }>('/users').then((r) => r.users),
  });
}

export function useUpdateUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; role: string }) => apiFetch<{ id: string; roles: string[] }>(`/users/${input.userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role: input.role }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

// Create User (Admin Console Phase 6) - status/role default server-side ('active'/'user')
// when omitted, same as backend/src/controllers/users.controller.ts's create().
export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string; status?: UserStatus; role?: string }) => apiFetch<{ id: string; email: string; status: UserStatus; roles: string[] }>('/users', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUserStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; status: UserStatus }) => apiFetch<{ id: string; status: UserStatus }>(`/users/${input.userId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: input.status }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

export interface UpdateUserInput {
  userId: string;
  email?: string;
  password?: string;
  status?: UserStatus;
  role?: string;
}

// Manage Users edit-then-save (Admin Console Phase 7) - a single consolidated PUT, body is
// only whichever fields actually changed (partial update - see
// backend/src/controllers/users.controller.ts's updateUser()).
export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...fields }: UpdateUserInput) => apiFetch<{ id: string; email: string; status: UserStatus; roles: string[] }>(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(fields),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}
