import { Navigate, Outlet } from 'react-router-dom';
import { useSession } from '../api/auth';
import PendingReviewPage from '../pages/PendingReviewPage';

// Wraps every route that requires a session. Renders nothing meaningful
// until the attempt-and-catch-401 session check (useSession) resolves, then
// either renders the nested route (<Outlet />) or bounces to /login.
export default function ProtectedRoute() {
  const { data: user, isLoading } = useSession();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary text-text-secondary">
        Loading…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Self-Registration & Password Policy - a 'pending' session (self-registered, awaiting an
  // admin to assign a role and activate them) has a valid cookie but gets nothing except this
  // banner, regardless of which protected route was actually requested - applies uniformly
  // here rather than per-page, so there's no route anyone could still reach with real access.
  if (user.status === 'pending') {
    return <PendingReviewPage />;
  }

  return <Outlet />;
}
