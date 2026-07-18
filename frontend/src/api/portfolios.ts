import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface PortfolioSummary {
  id: string;
  name: string;
  broker: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioHolding {
  id: string;
  symbol: string;
  name: string | null;
  quantity: number;
  purchasePrice: number;
  currentPrice: number;
  sector: string | null;
  purchaseDate: string | null;
  costBasis: number;
  currentValue: number;
  gainLoss: number;
  returnPct: number;
  allocationPct: number | null;
  priceUpdatedAt: string | null;
}

export interface PortfolioDetail extends PortfolioSummary {
  cashAmount: number;
  holdings: PortfolioHolding[];
  totalHoldingsValue: number;
  totalCostBasis: number;
  totalGainLoss: number;
  totalPortfolioValue: number;
}

export interface ImportResult {
  holdingsCount: number;
  cashAmount: number;
  actionsLogged: number;
  uploadId: string;
}

// Matches backend/src/services/parser.service.ts's HoldingEntry — the
// as-parsed shape, before portfolio.service.ts adds DB fields (id,
// allocationPct, priceUpdatedAt) on a real import.
export interface ParsedHoldingEntry {
  symbol: string;
  name: string;
  quantity: number;
  purchasePrice: number;
  currentPrice: number;
  sector: string;
  purchaseDate: string;
  costBasis: number;
  currentValue: number;
  gainLoss: number;
  returnPct: number;
}

export interface ImportPreviewResult {
  preview: true;
  sourceFormat: string;
  holdings: ParsedHoldingEntry[];
  cashAmount: number;
  errors: string[];
}

export function usePortfolios() {
  return useQuery({
    queryKey: ['portfolios'],
    queryFn: () => apiFetch<{ portfolios: PortfolioSummary[] }>('/portfolios').then((r) => r.portfolios),
  });
}

export function usePortfolio(id: string | null) {
  return useQuery({
    queryKey: ['portfolios', id],
    queryFn: () => apiFetch<{ portfolio: PortfolioDetail }>(`/portfolios/${id}`).then((r) => r.portfolio),
    enabled: id !== null,
  });
}

export function useCreatePortfolio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; broker?: string | null }) => apiFetch<{ portfolio: PortfolioSummary }>('/portfolios', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => r.portfolio),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portfolios'] }),
  });
}

// PUT /portfolios/:id — renames tx_portfolios.name (existed server-side since
// Phase 1; this was just never wired up in the frontend). Takes the id at
// call time, not hook-construction time, since PortfolioSelector renders a
// list and any entry in it might be the one being renamed.
export function useUpdatePortfolio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; name: string }) => apiFetch<{ portfolio: PortfolioSummary }>(`/portfolios/${input.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: input.name }),
    }).then((r) => r.portfolio),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portfolios'] }),
  });
}

export function useDeletePortfolio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ success: true }>(`/portfolios/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portfolios'] }),
  });
}

// POST /portfolios/:id/import unconditionally REPLACES all holdings — the
// caller (UploadImportDialog) is responsible for confirming with the user
// before calling this mutation. See Architecture.md's Phase 3 plan.
export function useImportHoldings(portfolioId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { filename: string; content: string }) => apiFetch<ImportResult>(`/portfolios/${portfolioId}/import`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolios', portfolioId] });
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
    },
  });
}

// Dry run — the backend returns the parsed preview and never opens a DB
// transaction (see portfolio.controller.ts's dryRun branch), so nothing
// needs invalidating on success.
export function usePreviewImport(portfolioId: string) {
  return useMutation({
    mutationFn: (input: { filename: string; content: string }) => apiFetch<ImportPreviewResult>(`/portfolios/${portfolioId}/import`, {
      method: 'POST',
      body: JSON.stringify({ ...input, dryRun: true }),
    }),
  });
}

export function useRefreshPrices(portfolioId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ holdings: unknown[] }>(`/portfolios/${portfolioId}/refresh-prices`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portfolios', portfolioId] }),
  });
}
