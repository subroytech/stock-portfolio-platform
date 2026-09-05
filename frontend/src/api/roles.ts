import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface Role {
  id: string;
  name: string;
  userCount: number;
}

// GET /roles (backend/src/routes/roles.routes.ts, requirePermission('roles:manage')) - used
// by UserRolesPage's role-change dropdown (Admin Console Phase 2) and RolesPage/
// RolePermissionsPage (Phase 3).
export function useRoles() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: () => apiFetch<{ roles: Role[] }>('/roles').then((r) => r.roles),
  });
}

// View/Create Role (Admin Console Phase 3) - name only, no rename/delete.
export function useCreateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => apiFetch<{ role: Role }>('/roles', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }).then((r) => r.role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['roles'] }),
  });
}

// Manage Role (Admin Console Phase 7) - blocked server-side if any user still holds the
// role (see backend/src/services/roles.service.ts's deleteRole); the frontend's userCount
// check is a convenience, not the real guard.
export function useDeleteRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (roleId: string) => apiFetch<{ success: true }>(`/roles/${roleId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['roles'] }),
  });
}

// View/Edit Permission (Admin Console Phase 3) - a role's current permission grants, and
// grant/revoke mutations. The FK on m_role_permissions.permission_key (migration 016)
// guarantees these can never reference a key that isn't a real registered function.
export function useRolePermissions(roleId: string | null) {
  return useQuery({
    queryKey: ['rolePermissions', roleId],
    queryFn: () => apiFetch<{ permissions: string[] }>(`/roles/${roleId}/permissions`).then((r) => r.permissions),
    enabled: roleId !== null,
  });
}

export function useGrantPermission(roleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (permissionKey: string) => apiFetch<{ permissions: string[] }>(`/roles/${roleId}/permissions`, {
      method: 'POST',
      body: JSON.stringify({ permissionKey }),
    }).then((r) => r.permissions),
    onSuccess: (permissions) => queryClient.setQueryData(['rolePermissions', roleId], permissions),
  });
}

export function useRevokePermission(roleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (permissionKey: string) => apiFetch<{ permissions: string[] }>(`/roles/${roleId}/permissions/${permissionKey}`, {
      method: 'DELETE',
    }).then((r) => r.permissions),
    onSuccess: (permissions) => queryClient.setQueryData(['rolePermissions', roleId], permissions),
  });
}
