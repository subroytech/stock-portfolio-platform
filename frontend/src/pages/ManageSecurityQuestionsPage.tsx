import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSecurityQuestions, useMySecurityQuestions, useUpdateSecurityQuestions } from '../api/auth';
import { ApiError } from '../api/client';
import SecurityQuestionPicker from '../components/SecurityQuestionPicker';

const REQUIRED_QUESTION_COUNT = 5;

// Self-Registration & Password Policy - post-login "Manage Security Questions," reached via the
// header's user-icon menu (UserPersonaBadge.tsx). Also how an admin-created account (which never
// collects any at creation) sets them up for the first time - same screen either way, since
// replaceUserAnswers() is a full replace regardless of whether anything existed before.
//
// Since answers are one-way hashed, existing answers can never be shown back or "kept" - the
// user's currently-set questions are only pre-checked (from GET .../mine) so they don't have to
// remember which ones they picked, but every answer must be retyped fresh, same as a password
// field.
export default function ManageSecurityQuestionsPage() {
  const navigate = useNavigate();
  const questionsQuery = useSecurityQuestions();
  const mineQuery = useMySecurityQuestions();
  const updateSecurityQuestions = useUpdateSecurityQuestions();

  const [currentPassword, setCurrentPassword] = useState('');
  // Fixed 5 slots, same shape as SignupPage.tsx - see SecurityQuestionPicker.tsx's own note.
  const [slotSelections, setSlotSelections] = useState<(string | null)[]>(Array(REQUIRED_QUESTION_COUNT).fill(null));
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [initialized, setInitialized] = useState(false);
  const [success, setSuccess] = useState(false);

  // Pre-fill the account's existing selection into the slots exactly once, as soon as it's
  // loaded - never again afterward, so the user's own in-progress edits are never clobbered by
  // a background refetch (e.g. right after a successful save invalidates this same query). An
  // account with none set (e.g. admin-created) gets 7 empty slots, same as a brand-new signup.
  useEffect(() => {
    if (!initialized && mineQuery.data) {
      const saved = mineQuery.data.questions.map((q) => q.id);
      setSlotSelections([...saved, ...Array(REQUIRED_QUESTION_COUNT - saved.length).fill(null)]);
      setInitialized(true);
    }
  }, [initialized, mineQuery.data]);

  const questions = questionsQuery.data?.questions ?? [];
  const allAnswered = slotSelections.every((id) => id != null && (answers[id] ?? '').trim().length > 0);
  const canSubmit = currentPassword.length > 0 && allAnswered;

  function handleSlotChange(slotIndex: number, questionId: string | null) {
    const previousId = slotSelections[slotIndex];
    setSlotSelections((prev) => prev.map((id, i) => (i === slotIndex ? questionId : id)));
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
      await updateSecurityQuestions.mutateAsync({
        currentPassword,
        securityAnswers: slotSelections.map((id) => ({ questionId: id!, answer: (answers[id!] ?? '').trim() })),
      });
      setSuccess(true);
      setCurrentPassword('');
      setAnswers({});
    } catch {
      // error surfaced below via updateSecurityQuestions.isError
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4 py-10">
      <form onSubmit={handleSubmit} className="w-full max-w-lg rounded-card bg-bg-card p-8 shadow-card">
        <h1 className="mb-2 text-xl font-semibold text-text-primary">Manage Security Questions</h1>
        <p className="mb-6 text-sm text-text-secondary">
          These are used to verify your identity if you ever forget your password. Choose {REQUIRED_QUESTION_COUNT} questions and answer
          each one - every answer must be re-entered, even for a question you already had set, since answers are never stored in a
          readable form.
        </p>

        {success && (
          <p className="mb-4 rounded-btn bg-success/10 px-3 py-2 text-sm text-success" data-testid="security-questions-success">
            Your security questions have been updated.
          </p>
        )}

        {mineQuery.data?.questions.length === 0 && (
          <p className="mb-4 rounded-btn bg-warning/10 px-3 py-2 text-sm text-warning" data-testid="security-questions-none-set">
            You don't have any security questions set up yet - Forgot Password won't work for this account until you do.
          </p>
        )}

        {(questionsQuery.isLoading || mineQuery.isLoading) && <p className="mb-4 text-sm text-text-secondary">Loading…</p>}
        {questionsQuery.isError && <p className="mb-4 text-sm text-danger">Could not load security questions. Please refresh and try again.</p>}

        {questions.length > 0 && initialized && (
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

        <label className="mb-1 block text-sm text-text-secondary" htmlFor="current-password">Current password</label>
        <input
          id="current-password" type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
          data-testid="security-questions-current-password"
          className="mb-4 w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
        />

        {updateSecurityQuestions.isError && (
          <p className="mb-4 text-sm text-danger">
            {updateSecurityQuestions.error instanceof ApiError ? updateSecurityQuestions.error.message : 'Something went wrong.'}
          </p>
        )}

        <button
          type="submit"
          disabled={updateSecurityQuestions.isPending || !canSubmit}
          data-testid="security-questions-submit"
          className="w-full rounded-btn bg-accent px-4 py-2 font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {updateSecurityQuestions.isPending ? 'Saving…' : 'Save'}
        </button>

        <button
          type="button"
          onClick={() => navigate('/')}
          className="mt-3 w-full text-center text-sm text-text-secondary hover:underline"
        >
          Back
        </button>
      </form>
    </div>
  );
}
