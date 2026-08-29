import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export type TemplateStatus = 'Pending Approval' | 'Approved' | 'Rejected';

// { targetField: sourceHeaderText } — mirrors backend/src/services/flexParser.service.ts's
// ColumnMapping wire shape exactly.
export type ColumnMapping = Record<string, string>;

// Mirrors backend/src/services/flexParser.service.ts's CashConfig/CashValueSource exactly - a
// discriminated union so Pattern #1 (separate value column) and Pattern #2 (value fused into
// the marker cell itself) can be added/extended without another migration each time. Omitting
// valueSource entirely means the implicit fallback: quantity x currentPrice.
export type CashValueSource =
  | { type: 'column'; columnIndex: number }
  | { type: 'embedded' };

export interface CashConfig {
  markerColumnIndex: number;
  markerText: string;
  valueSource?: CashValueSource;
}

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
  footerMarkerColumnIndex: number | null;
  footerMarkerText: string | null;
  cashConfig: CashConfig | null;
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

// DELETE /portfolio-templates/:id — Admin Console approval screen only. Hard delete, only
// valid while Rejected/Pending Approval and not bound to any portfolio (backend enforces both
// - 409 otherwise).
export function useDeleteTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ success: true }>(`/portfolio-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolioTemplates'] });
    },
  });
}

// The "bound portfolios" pop-up - shown when the Delete above 409s because the template is
// still in use. Resolves by deleting the specific portfolios blocking it (never a cascade -
// see CLAUDE.md's "Portfolio Template delete" note), one explicit admin action at a time.
export interface BoundPortfolio {
  id: string;
  name: string;
  ownerEmail: string;
  createdAt: string;
}

export function useBoundPortfolios(templateId: string | null) {
  return useQuery({
    queryKey: ['portfolioTemplates', 'boundPortfolios', templateId],
    queryFn: () => apiFetch<{ portfolios: BoundPortfolio[] }>(`/portfolio-templates/${templateId}/bound-portfolios`).then((r) => r.portfolios),
    enabled: templateId !== null,
  });
}

// Deletes a portfolio the admin doesn't own, but only one still bound to this specific template
// - the backend enforces that scoping itself (404 otherwise), this isn't just a UI convention.
export function useDeleteBoundPortfolio(templateId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (portfolioId: string) => apiFetch<{ success: true }>(`/portfolio-templates/${templateId}/bound-portfolios/${portfolioId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolioTemplates', 'boundPortfolios', templateId] });
    },
  });
}

// The other half of this screen's template-health concern: Flex portfolios stuck in
// 'Flex-Err' (created via Flex, but the owning user never completed Save Template or Delete
// Portfolio) - otherwise visible to no one but that one user, forever, if they abandon it.
export interface UnattachedFlexPortfolio {
  id: string;
  name: string;
  ownerEmail: string;
  createdAt: string;
  holdingsCount: number;
  cashAmount: number;
}

export function useUnattachedFlexPortfolios() {
  return useQuery({
    queryKey: ['portfolioTemplates', 'unattachedPortfolios'],
    queryFn: () => apiFetch<{ portfolios: UnattachedFlexPortfolio[] }>('/portfolio-templates/unattached-portfolios').then((r) => r.portfolios),
  });
}

// Deletes a portfolio the admin doesn't own, but only one still genuinely stuck in 'Flex-Err'
// - the backend enforces that scoping itself (404 otherwise), this isn't just a UI convention.
export function useDeleteUnattachedFlexPortfolio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (portfolioId: string) => apiFetch<{ success: true }>(`/portfolio-templates/unattached-portfolios/${portfolioId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolioTemplates', 'unattachedPortfolios'] });
    },
  });
}
