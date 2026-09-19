import { useNavigate } from 'react-router-dom';
import { useStopImpersonating } from '../api/auth';
import type { User } from '../api/auth';

interface ImpersonationBannerProps {
  session: User;
  // Where "Return to my account" lands - TabShell and AdminPage each pass their own, so this
  // stays a reusable strip rather than hardcoding "always back to /admin."
  returnPath: string;
}

// "Login-as" (CLAUDE.md's "Login-as" section) - an unmissable, full-width strip while the
// current session is an admin-master impersonating someone else. Rendered in both TabShell's
// and AdminPage's headers (whichever the impersonated user's own permissions let them reach),
// never hidden behind a scroll.
export default function ImpersonationBanner({ session, returnPath }: ImpersonationBannerProps) {
  const stopImpersonating = useStopImpersonating();
  const navigate = useNavigate();

  if (!session.impersonating) return null;

  async function handleReturn() {
    await stopImpersonating.mutateAsync();
    navigate(returnPath);
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 border-b border-warning bg-warning/10 px-4 py-2 text-sm sm:px-6"
      data-testid="impersonation-banner"
    >
      <span className="text-warning">
        You are viewing as <span className="font-medium">{session.email}</span>.
      </span>
      <button
        type="button"
        onClick={handleReturn}
        disabled={stopImpersonating.isPending}
        data-testid="return-to-my-account"
        className="rounded-btn border border-warning px-3 py-1.5 text-sm text-warning transition-colors hover:bg-warning/20 disabled:opacity-60"
      >
        {stopImpersonating.isPending ? 'Returning…' : 'Return to my account'}
      </button>
    </div>
  );
}
