import { useEffect, useRef, useState } from 'react';
import { useRateLimitStatus } from '../api/rateLimitStatus';

const AUTO_DISMISS_MS = 6000;

// Fires a brief, self-dismissing banner the instant a non-admin session's own combined rate
// limit first flips from within-budget to exhausted - the persistent header badge
// (RateLimitIndicator.tsx) alone isn't enough, since the user might not be looking at the header
// at the exact moment they cross the line. Mounted exactly once in TabShell.tsx (not alongside
// every RateLimitIndicator badge, which can be mounted twice at once - TabShell's header plus an
// open CandlestickPopup - and would otherwise fire the toast twice for the same transition).
export default function RateLimitBlockedToast() {
  const { data } = useRateLimitStatus(true);
  const [visible, setVisible] = useState(false);
  const wasBlockedRef = useRef(false);

  useEffect(() => {
    if (!data || data.exempt || data.remaining === null) return;
    const blocked = data.remaining <= 0;
    if (blocked && !wasBlockedRef.current) {
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), AUTO_DISMISS_MS);
      wasBlockedRef.current = true;
      return () => clearTimeout(timer);
    }
    if (!blocked) {
      wasBlockedRef.current = false;
    }
  }, [data]);

  if (!visible || !data || data.windowMinutes < 0) return null;

  return (
    <div
      data-testid="rate-limit-blocked-toast"
      role="alert"
      className="fixed left-1/2 top-4 z-[60] w-full max-w-sm -translate-x-1/2 rounded-card border border-danger bg-danger px-4 py-3 text-sm font-medium text-white shadow-card-lg"
    >
      You've reached your request limit. Wait {data.windowMinutes} minutes for your limit to refresh.
    </div>
  );
}
