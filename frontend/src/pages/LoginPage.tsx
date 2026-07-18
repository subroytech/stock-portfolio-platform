import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLogin } from '../api/auth';
import { ApiError } from '../api/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useLogin();
  const navigate = useNavigate();

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

        <label className="mb-1 block text-sm text-text-secondary" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
        />

        <label className="mb-1 block text-sm text-text-secondary" htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
