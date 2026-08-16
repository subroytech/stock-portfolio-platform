import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export type TemplateStatus = 'Pending Approval' | 'Approved' | 'Rejected';

// { targetField: sourceHeaderText } — mirrors backend/src/services/flexParser.service.ts's
// ColumnMapping wire shape exactly.
export type ColumnMapping = Record<string, string>;

export interface TemplateSummary {
  id: string;
  templateName: string;
  status: TemplateStatus;
  createdBy: string | null;
  createdAt: string;
  howToUseDescription: string | null;
}

export interface TemplateDetail extends TemplateSummary {
  reviewedBy: string | null;
  reviewedAt: string | null;
  samplePreview: unknown;
  columnMapping: ColumnMapping;
  headerRowIndex: number;
  dataStartColumnIndex: number;
}

export const MANDATORY_TARGET_FIELDS = ['symbol', 'quantity', 'currentPrice'] as const;
export const OPTIONAL_TARGET_FIELDS = ['purchasePrice', 'name', 'sector', 'purchaseDate'] as const;
export const ALL_TARGET_FIELDS = [...MANDATORY_TARGET_FIELDS, ...OPTIONAL_TARGET_FIELDS] as const;

export const TARGET_FIELD_LABELS: Record<string, string> = {
  symbol: 'Symbol',
  quantity: 'Quantity',
  currentPrice: 'Current Price',
  purchasePrice: 'Purchase Price',
  name: 'Name',
  sector: 'Sector',
  purchaseDate: 'Purchase Date',
};

// GET /portfolio-templates?search= — the "Existing Template" list (Approved, created by
// admin/admin-master or the caller themselves — filtered server-side, not a flat shared pool).
export function useApprovedTemplates(search?: string) {
  return useQuery({
    queryKey: ['portfolioTemplates', 'approved', search ?? ''],
    queryFn: () => apiFetch<{ templates: TemplateSummary[] }>(`/portfolio-templates${search ? `?search=${encodeURIComponent(search)}` : ''}`).then((r) => r.templates),
  });
}

// GET /portfolio-templates/mine/pending — the personal "Pending Approval" dropdown, shown
// only when it's non-empty.
export function useMyPendingTemplates() {
  return useQuery({
    queryKey: ['portfolioTemplates', 'mine', 'pending'],
    queryFn: () => apiFetch<{ templates: TemplateSummary[] }>('/portfolio-templates/mine/pending').then((r) => r.templates),
  });
}

// GET /portfolio-templates/admin/all — the Admin Console approval screen's full list,
// regardless of status/creator (portfolio_template:manage_status).
export function useAllTemplates() {
  return useQuery({
    queryKey: ['portfolioTemplates', 'admin', 'all'],
    queryFn: () => apiFetch<{ templates: TemplateSummary[] }>('/portfolio-templates/admin/all').then((r) => r.templates),
  });
}

// Admin Console approval screen only (portfolio_template:manage_status) — full detail
// including the mapping + sample_preview, so an admin can judge a Pending template without
// needing the original file.
export function useTemplateDetail(id: string | null) {
  return useQuery({
    queryKey: ['portfolioTemplates', 'detail', id],
    queryFn: () => apiFetch<{ template: TemplateDetail }>(`/portfolio-templates/${id}`).then((r) => r.template),
    enabled: id !== null,
  });
}

export function useSetTemplateStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; status: 'Approved' | 'Rejected' }) => apiFetch<{ success: true }>(`/portfolio-templates/${input.id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: input.status }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolioTemplates'] });
    },
  });
}
