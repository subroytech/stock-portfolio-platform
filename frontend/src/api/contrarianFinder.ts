import { useMutation } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface StrengthSignal {
  rsi: number;
  sma20: number;
  sma50: number;
  rr: number;
  kF: number;
  halfKelly: number;
}

export interface ScanResult {
  symbol: string;
  filterFail: boolean;
  noData?: boolean;
  error?: string;
  name?: string;
  sector?: string;
  price?: number;
  mktCap?: number;
  volume?: number;
  avgVol?: number;
  changePct?: number;
  mktClosed?: boolean;
  strength?: StrengthSignal | null;
  source?: string;
}

export interface ScanInput {
  threshold?: number;
  batchSize?: number;
  maxBatches?: number;
  qualityPreset?: 'standard' | 'relaxed';
  scanDays?: number;
}

export interface ScanResponse {
  universeSize: number;
  scanned: number;
  threshold: number;
  candidates: ScanResult[];
}

export function useContrarianScan() {
  return useMutation({
    mutationFn: (input: ScanInput) => apiFetch<ScanResponse>('/contrarian-finder/scan', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  });
}
