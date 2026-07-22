import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSignup } from '../api/auth';
import { ApiError } from '../api/client';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const signup = useSignup();
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await signup.mutateAsync({ email, password });
      navigate('/', { replace: true });
    } catch {
      // error surfaced below via signup.isError
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-card bg-bg-card p-8 shadow-card"
      >
        <h1 className="mb-6 text-xl font-semibold text-text-primary">Sign up</h1>

        <label className="mb-1 block text-sm text-text-secondary" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="signup-email"
          className="mb-4 w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
        />

        <label className="mb-1 block text-sm text-text-secondary" htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="signup-password"
          className="mb-1 w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
        />
        <p className="mb-4 text-xs text-text-muted">At least 8 characters.</p>

        {signup.isError && (
          <p className="mb-4 text-sm text-danger">
            {signup.error instanceof ApiError ? signup.error.message : 'Something went wrong.'}
          </p>
        )}

        <button
          type="submit"
          disabled={signup.isPending}
          data-testid="signup-submit"
          className="w-full rounded-btn bg-accent px-4 py-2 font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {signup.isPending ? 'Creating account…' : 'Sign up'}
        </button>

        <p className="mt-4 text-center text-sm text-text-secondary">
          Already have an account? <Link to="/login" className="text-accent hover:underline">Log in</Link>
        </p>
      </form>
    </div>
  );
}
