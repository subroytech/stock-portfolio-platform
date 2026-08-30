import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSignup, useRandomSecurityQuestions } from '../api/auth';
import { ApiError } from '../api/client';
import { allPasswordRulesPass } from '../lib/passwordPolicy';
import PasswordRequirementsChecklist from '../components/PasswordRequirementsChecklist';

const ANSWER_MAX_LENGTH = 20;

// Self-Registration & Password Policy - "Register New User." Collects everything the account
// needs up front (name, password meeting the full policy, and answers to all 7 randomly-
// offered security questions) since the account is created 'pending' with no role - there's no
// later "finish setting up" step for any of this.
export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const signup = useSignup();
  const questionsQuery = useRandomSecurityQuestions();
  const navigate = useNavigate();

  const emailLocalPart = email.split('@')[0] ?? '';
  const questions = questionsQuery.data?.questions ?? [];
  const allAnswered = questions.length > 0 && questions.every((q) => (answers[q.id] ?? '').trim().length > 0);
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const canSubmit = allPasswordRulesPass(password, { firstName, lastName, emailLocalPart }) && passwordsMatch && allAnswered && !!firstName.trim() && !!lastName.trim();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      await signup.mutateAsync({
        email, password, firstName: firstName.trim(), lastName: lastName.trim(),
        securityAnswers: questions.map((q) => ({ questionId: q.id, answer: (answers[q.id] ?? '').trim() })),
      });
      navigate('/', { replace: true });
    } catch {
      // error surfaced below via signup.isError
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4 py-10">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-card bg-bg-card p-8 shadow-card"
      >
        <h1 className="mb-6 text-xl font-semibold text-text-primary">Register New User</h1>

        <label className="mb-1 block text-sm text-text-secondary" htmlFor="email">Email</label>
        <input
          id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          data-testid="signup-email"
          className="mb-4 w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
        />

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm text-text-secondary" htmlFor="firstName">First name</label>
            <input
              id="firstName" required value={firstName} onChange={(e) => setFirstName(e.target.value)}
              data-testid="signup-first-name"
              className="w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-text-secondary" htmlFor="lastName">Last name</label>
            <input
              id="lastName" required value={lastName} onChange={(e) => setLastName(e.target.value)}
              data-testid="signup-last-name"
              className="w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
            />
          </div>
        </div>

        <label className="mb-1 block text-sm text-text-secondary" htmlFor="password">Password</label>
        <input
          id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
          data-testid="signup-password"
          className="mb-2 w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
        />
        <PasswordRequirementsChecklist password={password} firstName={firstName} lastName={lastName} emailLocalPart={emailLocalPart} />

        <label className="mb-1 block text-sm text-text-secondary" htmlFor="confirmPassword">Confirm password</label>
        <input
          id="confirmPassword" type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
          data-testid="signup-confirm-password"
          className="mb-1 w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
        />
        <p className="mb-4 text-xs text-danger" data-testid="signup-password-mismatch">
          {confirmPassword.length > 0 && !passwordsMatch ? "Passwords don't match." : ' '}
        </p>

        <h2 className="mb-1 text-sm font-semibold text-text-primary">Security questions</h2>
        <p className="mb-3 text-xs text-text-secondary">
          Answer all {questions.length || 7} - these are used later to verify your identity if you forget your password. Each answer can be up to {ANSWER_MAX_LENGTH} characters.
        </p>
        {questionsQuery.isLoading && <p className="mb-4 text-sm text-text-secondary">Loading questions…</p>}
        {questionsQuery.isError && <p className="mb-4 text-sm text-danger">Could not load security questions. Please refresh and try again.</p>}
        <div className="mb-4 space-y-3">
          {questions.map((q) => (
            <div key={q.id}>
              <label className="mb-1 block text-sm text-text-secondary" htmlFor={`answer-${q.id}`}>{q.questionText}</label>
              <input
                id={`answer-${q.id}`}
                required
                maxLength={ANSWER_MAX_LENGTH}
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                data-testid={`signup-answer-${q.id}`}
                className="w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
              />
            </div>
          ))}
        </div>

        {signup.isError && (
          <p className="mb-4 text-sm text-danger">
            {signup.error instanceof ApiError ? signup.error.message : 'Something went wrong.'}
          </p>
        )}

        <button
          type="submit"
          disabled={signup.isPending || !canSubmit}
          data-testid="signup-submit"
          className="w-full rounded-btn bg-accent px-4 py-2 font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {signup.isPending ? 'Creating account…' : 'Register'}
        </button>

        <p className="mt-4 text-center text-sm text-text-secondary">
          Already have an account? <Link to="/login" className="text-accent hover:underline">Log in</Link>
        </p>
      </form>
    </div>
  );
}
