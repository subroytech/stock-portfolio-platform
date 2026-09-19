import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession, useChangePassword } from '../api/auth';
import { ApiError } from '../api/client';
import { allPasswordRulesPass } from '../lib/passwordPolicy';
import PasswordRequirementsChecklist from '../components/PasswordRequirementsChecklist';

// Self-Registration & Password Policy - the logged-in "I know my current password" path,
// linked from TabShell.tsx's header. Distinct from ForgotPasswordPage.tsx (security-question
// based, for when the user is locked out and doesn't have a session at all).
export default function ChangePasswordPage() {
  const { data: session } = useSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [success, setSuccess] = useState(false);
  const changePassword = useChangePassword();
  const navigate = useNavigate();

  const emailLocalPart = session?.email?.split('@')[0] ?? '';
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const canSubmit = currentPassword.length > 0
    && allPasswordRulesPass(newPassword, { firstName: session?.firstName ?? undefined, lastName: session?.lastName ?? undefined, emailLocalPart })
    && passwordsMatch;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      // error surfaced below via changePassword.isError
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4 py-10">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-card bg-bg-card p-8 shadow-card"
      >
        <h1 className="mb-6 text-xl font-semibold text-text-primary">Change Password</h1>

        {success && (
          <p className="mb-4 rounded-btn bg-success/10 px-3 py-2 text-sm text-success" data-testid="change-password-success">
            Your password has been updated.
          </p>
        )}

        <label className="mb-1 block text-sm text-text-secondary" htmlFor="currentPassword">Current password</label>
        <input
          id="currentPassword" type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
          data-testid="change-password-current"
          className="mb-4 w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
        />

        <label className="mb-1 block text-sm text-text-secondary" htmlFor="newPassword">New password</label>
        <input
          id="newPassword" type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
          data-testid="change-password-new"
          className="mb-2 w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
        />
        <PasswordRequirementsChecklist password={newPassword} firstName={session?.firstName ?? undefined} lastName={session?.lastName ?? undefined} emailLocalPart={emailLocalPart} />

        <label className="mb-1 block text-sm text-text-secondary" htmlFor="confirmNewPassword">Confirm new password</label>
        <input
          id="confirmNewPassword" type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
          data-testid="change-password-confirm"
          className="mb-1 w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
        />
        <p className="mb-4 text-xs text-danger">
          {confirmPassword.length > 0 && !passwordsMatch ? "Passwords don't match." : ' '}
        </p>

        {changePassword.isError && (
          <p className="mb-4 text-sm text-danger">
            {changePassword.error instanceof ApiError ? changePassword.error.message : 'Something went wrong.'}
          </p>
        )}

        <button
          type="submit"
          disabled={changePassword.isPending || !canSubmit}
          data-testid="change-password-submit"
          className="w-full rounded-btn bg-accent px-4 py-2 font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {changePassword.isPending ? 'Updating…' : 'Update Password'}
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
