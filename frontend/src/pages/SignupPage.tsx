import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSignup, useSecurityQuestions } from '../api/auth';
import { ApiError } from '../api/client';
import { allPasswordRulesPass } from '../lib/passwordPolicy';
import PasswordRequirementsChecklist from '../components/PasswordRequirementsChecklist';
import SecurityQuestionPicker from '../components/SecurityQuestionPicker';

const REQUIRED_QUESTION_COUNT = 5;

// Self-Registration & Password Policy - "Register New User." Collects everything the account
// needs up front (name, password meeting the full policy, and the user's own choice of 7 of
// the 15 security questions, answered) since the account is created 'pending' with no role -
// there's no later "finish setting up" step for any of this (though the questions can be
// changed later via ManageSecurityQuestionsPage.tsx once logged in).
export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // Fixed 5 slots, each null until that slot picks a question - see SecurityQuestionPicker.tsx's
  // own note for why (slot 1 offers all 15, slot 2 offers the 14 not picked elsewhere, etc.).
  const [slotSelections, setSlotSelections] = useState<(string | null)[]>(Array(REQUIRED_QUESTION_COUNT).fill(null));
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const signup = useSignup();
  const questionsQuery = useSecurityQuestions();
  const navigate = useNavigate();

  const emailLocalPart = email.split('@')[0] ?? '';
  const questions = questionsQuery.data?.questions ?? [];
  const allAnswered = slotSelections.every((id) => id != null && (answers[id] ?? '').trim().length > 0);
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const canSubmit = allPasswordRulesPass(password, { firstName, lastName, emailLocalPart }) && passwordsMatch && allAnswered && !!firstName.trim() && !!lastName.trim();

  function handleSlotChange(slotIndex: number, questionId: string | null) {
    const previousId = slotSelections[slotIndex];
    setSlotSelections((prev) => prev.map((id, i) => (i === slotIndex ? questionId : id)));
    // The old question in this slot is no longer selected anywhere - drop its now-stale answer
    // rather than leaving it orphaned in state (it'd never be submitted, but it's dead weight).
    if (previousId && previousId !== questionId) {
      setAnswers((prev) => {
        const next = { ...prev };
        delete next[previousId];
        return next;
      });
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      await signup.mutateAsync({
        email, password, firstName: firstName.trim(), lastName: lastName.trim(),
        securityAnswers: slotSelections.map((id) => ({ questionId: id!, answer: (answers[id!] ?? '').trim() })),
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
          {confirmPassword.length > 0 && !passwordsMatch ? "Passwords don't match." : ' '}
        </p>

        <h2 className="mb-1 text-sm font-semibold text-text-primary">Security questions</h2>
        <p className="mb-3 text-xs text-text-secondary">
          Pick a question for each of the {REQUIRED_QUESTION_COUNT} slots below and answer it - these are used later to verify your identity if you forget your password.
        </p>
        {questionsQuery.isLoading && <p className="mb-4 text-sm text-text-secondary">Loading questions…</p>}
        {questionsQuery.isError && <p className="mb-4 text-sm text-danger">Could not load security questions. Please refresh and try again.</p>}
        {questions.length > 0 && (
          <div className="mb-4">
            <SecurityQuestionPicker
              questions={questions}
              requiredCount={REQUIRED_QUESTION_COUNT}
              slotSelections={slotSelections}
              answers={answers}
              onSlotChange={handleSlotChange}
              onAnswerChange={(id, value) => setAnswers((prev) => ({ ...prev, [id]: value }))}
            />
          </div>
        )}

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
