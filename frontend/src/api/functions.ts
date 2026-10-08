import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export type FunctionStatus = 'active' | 'inactive' | 'Dev-WIP' | 'QA-Test';

export interface FunctionMasterRow {
  id: string;
  permissionKey: string;
  name: string;
  description: string | null;
  status: FunctionStatus;
}

// GET /functions (backend/src/routes/functionMaster.routes.ts, requirePermission('permissions:manage')
// for reads) - default (activeOnly) feeds RolePermissionsPage's fixed-dropdown picker (Admin
// Console Phase 3), filtered server-side to 'active'+'QA-Test'. "View/Manage Functions" itself
// (Phase 4) will call this with activeOnly: false (?all=true) to see every row regardless of status.
export function useFunctions({ activeOnly = true }: { activeOnly?: boolean } = {}) {
  return useQuery({
    queryKey: ['functions', { activeOnly }],
    queryFn: () => apiFetch<{ functions: FunctionMasterRow[] }>(`/functions${activeOnly ? '' : '?all=true'}`).then((r) => r.functions),
  });
}

// View/Manage Functions (Admin Console Phase 4) - create (permissionKey/name/description/
// status) + status-only edit for existing rows. permission_key/name intentionally can't be
// changed after creation (see backend/src/services/functionMaster.service.ts) - it's tied to
// a real requirePermission(key) call in code.
export function useCreateFunction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { permissionKey: string; name: string; description: string | null; status: FunctionStatus }) => apiFetch<{ function: FunctionMasterRow }>('/functions', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => r.function),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['functions'] }),
  });
}

export function useUpdateFunctionStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; status: FunctionStatus }) => apiFetch<{ function: FunctionMasterRow }>(`/functions/${input.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: input.status }),
    }).then((r) => r.function),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['functions'] }),
  });
}
