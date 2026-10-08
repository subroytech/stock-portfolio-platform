import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';

// Backs the header "(i)"/"W" rate-limit indicator (RateLimitIndicator.tsx) - a user's own status
// against the combined all-encompassing rate limit (fmpRateLimit.service.ts on the backend).
export interface RateLimitStatusResponse {
  exempt: boolean;
  limit: number;
  windowMinutes: number;
  usedInWindow: number;
  remaining: number | null;
}

export const RATE_LIMIT_STATUS_QUERY_KEY = ['rateLimitStatus'];

// `enabled` is passed in (not decided internally) so a session that's exempt (admin/admin-master)
// never fires this fetch at all - TabShell.tsx/CandlestickPopup.tsx don't even mount
// RateLimitIndicator for those sessions, but the hook itself stays defensive too.
export function useRateLimitStatus(enabled: boolean) {
  return useQuery({
    queryKey: RATE_LIMIT_STATUS_QUERY_KEY,
    queryFn: () => apiFetch<RateLimitStatusResponse>('/rate-limit/status'),
    enabled,
    // A 20s poll is the freshness floor - most of the 5 rate-limited features' own mutation
    // hooks also invalidate this query on settle (see each hook's own onSettled), so in practice
    // the badge usually updates immediately after a user's own action, not just on this interval.
    refetchInterval: 20000,
  });
}
