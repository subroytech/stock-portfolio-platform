import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForgotPasswordStart, useForgotPasswordVerify, useForgotPasswordReset } from '../api/auth';
import type { SecurityQuestion } from '../api/auth';
import { ApiError } from '../api/client';
import { allPasswordRulesPass } from '../lib/passwordPolicy';
import PasswordRequirementsChecklist from '../components/PasswordRequirementsChecklist';

type Step = 'email' | 'questions' | 'newPassword' | 'done';

// Self-Registration & Password Policy - the security-question-based "Forgot Password" flow (no
// email provider involved). Three stateless steps, each handing a short-lived signed token to
// the next: email -> 4 challenge questions + challengeToken -> answers -> resetToken -> new
// password.
export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [questions, setQuestions] = useState<SecurityQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const start = useForgotPasswordStart();
  const verify = useForgotPasswordVerify();
  const reset = useForgotPasswordReset();
  const navigate = useNavigate();

  async function handleStart(e: FormEvent) {
    e.preventDefault();
    try {
      const result = await start.mutateAsync({ email });
      setChallengeToken(result.challengeToken);
      setQuestions(result.questions);
      setStep('questions');
    } catch {
      // error surfaced below via start.isError
    }
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    try {
      const result = await verify.mutateAsync({
        challengeToken,
        answers: questions.map((q) => ({ questionId: q.id, answer: (answers[q.id] ?? '').trim() })),
      });
      setResetToken(result.resetToken);
      setStep('newPassword');
    } catch {
      // error surfaced below via verify.isError
    }
  }

  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const canSubmitReset = allPasswordRulesPass(newPassword, {}) && passwordsMatch;

  async function handleReset(e: FormEvent) {
    e.preventDefault();
    if (!canSubmitReset) return;
    try {
      await reset.mutateAsync({ resetToken, newPassword });
      setStep('done');
    } catch {
      // error surfaced below via reset.isError
    }
  }

  const allAnswered = questions.length > 0 && questions.every((q) => (answers[q.id] ?? '').trim().length > 0);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4 py-10">
      <div className="w-full max-w-md rounded-card bg-bg-card p-8 shadow-card">
        <h1 className="mb-6 text-xl font-semibold text-text-primary">Forgot Password</h1>

        {step === 'email' && (
          <form onSubmit={handleStart}>
            <label className="mb-1 block text-sm text-text-secondary" htmlFor="forgot-email">Email</label>
            <input
              id="forgot-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              data-testid="forgot-password-email"
              className="mb-4 w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
            />
            {start.isError && (
              <p className="mb-4 text-sm text-danger">{start.error instanceof ApiError ? start.error.message : 'Something went wrong.'}</p>
            )}
            <button
              type="submit" disabled={start.isPending} data-testid="forgot-password-start-submit"
              className="w-full rounded-btn bg-accent px-4 py-2 font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {start.isPending ? 'Checking…' : 'Continue'}
            </button>
          </form>
        )}

        {step === 'questions' && (
          <form onSubmit={handleVerify}>
            <p className="mb-3 text-sm text-text-secondary">Answer all {questions.length} to verify it's you.</p>
            <div className="mb-4 space-y-3">
              {questions.map((q) => (
                <div key={q.id}>
                  <label className="mb-1 block text-sm text-text-secondary" htmlFor={`verify-${q.id}`}>{q.questionText}</label>
                  <input
                    id={`verify-${q.id}`} required maxLength={20} value={answers[q.id] ?? ''}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                    data-testid={`forgot-password-answer-${q.id}`}
                    className="w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
                  />
                </div>
              ))}
            </div>
            {verify.isError && (
              <p className="mb-4 text-sm text-danger">{verify.error instanceof ApiError ? verify.error.message : 'Something went wrong.'}</p>
            )}
            <button
              type="submit" disabled={verify.isPending || !allAnswered} data-testid="forgot-password-verify-submit"
              className="w-full rounded-btn bg-accent px-4 py-2 font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {verify.isPending ? 'Verifying…' : 'Verify'}
            </button>
          </form>
        )}

        {step === 'newPassword' && (
          <form onSubmit={handleReset}>
            <label className="mb-1 block text-sm text-text-secondary" htmlFor="reset-new-password">New password</label>
            <input
              id="reset-new-password" type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              data-testid="forgot-password-new-password"
              className="mb-2 w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
            />
            <PasswordRequirementsChecklist password={newPassword} />

            <label className="mb-1 block text-sm text-text-secondary" htmlFor="reset-confirm-password">Confirm new password</label>
            <input
              id="reset-confirm-password" type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              data-testid="forgot-password-confirm-password"
              className="mb-1 w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
            />
            <p className="mb-4 text-xs text-danger">
              {confirmPassword.length > 0 && !passwordsMatch ? "Passwords don't match." : ' '}
            </p>
            {reset.isError && (
              <p className="mb-4 text-sm text-danger">{reset.error instanceof ApiError ? reset.error.message : 'Something went wrong.'}</p>
            )}
            <button
              type="submit" disabled={reset.isPending || !canSubmitReset} data-testid="forgot-password-reset-submit"
              className="w-full rounded-btn bg-accent px-4 py-2 font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {reset.isPending ? 'Resetting…' : 'Set New Password'}
            </button>
          </form>
        )}

        {step === 'done' && (
          <div data-testid="forgot-password-done">
            <p className="mb-4 rounded-btn bg-success/10 px-3 py-2 text-sm text-success">
              Your password has been reset. You can now log in with your new password.
            </p>
            <button
              type="button" onClick={() => navigate('/login', { replace: true })}
              className="w-full rounded-btn bg-accent px-4 py-2 font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Go to Login
            </button>
          </div>
        )}

        {step !== 'done' && (
          <p className="mt-4 text-center text-sm text-text-secondary">
            <Link to="/login" className="text-accent hover:underline">Back to Login</Link>
          </p>
        )}
      </div>
    </div>
  );
}
