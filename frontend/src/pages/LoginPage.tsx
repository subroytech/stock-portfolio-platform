import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLogin } from '../api/auth';
import { ApiError } from '../api/client';
import { SESSION_EXPIRED_STORAGE_KEY } from '../lib/queryClient';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showSessionExpired, setShowSessionExpired] = useState(false);
  const login = useLogin();
  const navigate = useNavigate();

  // Set only by apiFetch's global 401 handling when a real session was cached at the time
  // (see lib/queryClient.ts's clearSession) - never by a plain first-ever visit or a failed
  // login/signup attempt, both of which start from a null session already.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_EXPIRED_STORAGE_KEY)) {
        setShowSessionExpired(true);
        sessionStorage.removeItem(SESSION_EXPIRED_STORAGE_KEY);
      }
    } catch { /* private browsing/quota */ }
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await login.mutateAsync({ email, password });
      navigate('/', { replace: true });
    } catch {
      // error surfaced below via login.isError
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-card bg-bg-card p-8 shadow-card"
      >
        <h1 className="mb-6 text-xl font-semibold text-text-primary">Log in</h1>

        {showSessionExpired && (
          <p
            data-testid="login-session-expired"
            className="mb-4 rounded-btn bg-warning/10 px-3 py-2 text-sm text-warning"
          >
            Your session ended — please log in again.
          </p>
        )}

        <label className="mb-1 block text-sm text-text-secondary" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="login-email"
          className="mb-4 w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
        />

        <div className="mb-1 flex items-center justify-between">
          <label className="block text-sm text-text-secondary" htmlFor="password">Password</label>
          <Link to="/forgot-password" className="text-xs text-accent hover:underline">Forgot password?</Link>
        </div>
        <input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="login-password"
          className="mb-4 w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
        />

        {login.isError && (
          <p className="mb-4 text-sm text-danger">
            {login.error instanceof ApiError ? login.error.message : 'Something went wrong.'}
          </p>
        )}

        <button
          type="submit"
          disabled={login.isPending}
          data-testid="login-submit"
          className="w-full rounded-btn bg-accent px-4 py-2 font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {login.isPending ? 'Logging in…' : 'Log in'}
        </button>

        <p className="mt-4 text-center text-sm text-text-secondary">
          Don't have an account? <Link to="/signup" className="text-accent hover:underline">Sign up</Link>
        </p>
      </form>
    </div>
  );
}
