import { useRateLimitStatus } from '../api/rateLimitStatus';

// Header "(i)"/"W" badge for the combined all-encompassing rate limit - mounted in both
// TabShell.tsx's header and CandlestickPopup.tsx's own header bar (the one full-screen view in
// this app that otherwise hides TabShell's header entirely). Never mounted at all for an
// admin/admin-master session (both call sites gate on session.roles before rendering this), so
// no exempt-state rendering is needed here.
//
// Toast-on-first-block lives separately in RateLimitBlockedToast.tsx, mounted exactly once in
// TabShell - not here, since this badge itself is mounted in more than one place at once
// (TabShell + an open CandlestickPopup) and would otherwise fire duplicate toasts for the same
// transition.
export default function RateLimitIndicator() {
  const { data, isLoading, isError } = useRateLimitStatus(true);

  if (isLoading || isError || !data || data.exempt || data.remaining === null) return null;

  const blocked = data.remaining <= 0;

  if (blocked) {
    return (
      <span
        data-testid="rate-limit-blocked"
        title={`Wait ${data.windowMinutes} minutes for your Limit Refresh`}
        className="flex h-6 w-6 shrink-0 animate-pulse items-center justify-center rounded-full bg-danger text-xs font-extrabold text-white"
      >
        W
      </span>
    );
  }

  return (
    <span
      data-testid="rate-limit-ok"
      title={`${data.remaining} of ${data.limit} Left`}
      className="flex h-6 w-6 shrink-0 animate-pulse items-center justify-center rounded-full bg-success text-[.65rem] font-bold text-white"
    >
      (i)
    </span>
  );
}
