import { useLogout } from '../api/auth';

// Self-Registration & Password Policy - rendered by ProtectedRoute.tsx in place of the real app
// for any session with status === 'pending'. Deliberately shows nothing else - "no access to
// any function" is enforced here by simply never rendering <Outlet />, not by a permission
// check (a pending account has zero roles, so every permission check would fail anyway, but
// this is the actual UI-level gate).
export default function PendingReviewPage() {
  const logout = useLogout();

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4">
      <div className="w-full max-w-md rounded-card bg-bg-card p-8 text-center shadow-card" data-testid="pending-review-banner">
        <h1 className="mb-3 text-lg font-semibold text-text-primary">Thanks for Registering</h1>
        <p className="mb-6 text-sm text-text-secondary">
          Your Registration Request is under Review and will get activated Soon. Thanks for your patience.
        </p>
        <button
          type="button"
          onClick={() => logout.mutate()}
          className="rounded-btn border border-border px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-primary"
        >
          Log out
        </button>
      </div>
    </div>
  );
}
