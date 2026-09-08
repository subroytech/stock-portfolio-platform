import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { HistoricalBar } from '../lib/stockPreview';

export interface StockPreviewQuote {
  price: number;
  changeDollar: number;
  changePercent: number;
  name: string;
  isActivelyTrading: boolean;
}

export interface StockPreviewResponse {
  symbol: string;
  quote: StockPreviewQuote | null;
  historical: HistoricalBar[];
}

export function useStockPreview(symbol: string | null) {
  return useQuery({
    queryKey: ['stock-preview', symbol],
    // Threading React Query's own AbortSignal through to fetch() lets it actually cancel a
    // superseded request client-side (e.g. React StrictMode's dev-only mount/unmount/remount
    // cycle firing this query twice on first paint) instead of a "cancelled" query still
    // completing as a real network call - which, now that this endpoint logs real usage, was
    // showing up as inflated stock_preview counts (a genuine bug found live: one lookup
    // produced 4 logged calls instead of 1).
    queryFn: ({ signal }) => apiFetch<StockPreviewResponse>(`/stock-preview/${encodeURIComponent(symbol!)}`, { signal }),
    enabled: symbol !== null,
  });
}
