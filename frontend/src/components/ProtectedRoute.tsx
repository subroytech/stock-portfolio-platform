import { Navigate, Outlet } from 'react-router-dom';
import { useSession } from '../api/auth';

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

  return <Outlet />;
}
