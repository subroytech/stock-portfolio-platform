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
    queryFn: () => apiFetch<StockPreviewResponse>(`/stock-preview/${encodeURIComponent(symbol!)}`),
    enabled: symbol !== null,
  });
}
