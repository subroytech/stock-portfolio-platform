import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { User } from '../api/auth';

interface UserPersonaBadgeProps {
  user: User;
}

// Initials from the email's local-part (before @) - first two letters, uppercased. No display
// name existed anywhere in this schema when this was first written; users.first_name/last_name
// exist now (Self-Registration & Password Policy), but the badge itself is unchanged - only its
// behavior (click to open a menu) is new.
function initialsFor(email: string): string {
  const localPart = email.split('@')[0] ?? email;
  return localPart.slice(0, 2).toUpperCase();
}

// "Who is logged in" persona seal, shown in both TabShell's and AdminPage's headers. Full
// detail (email + role(s)) on hover via the plain `title` attribute - this codebase's
// already-established tooltip convention. Also the entry point for the account menu (Change
// Password / Manage Security Questions) - clicking it opens a small dropdown, consolidating
// what used to be a separate standalone "Change Password" header link.
export default function UserPersonaBadge({ user }: UserPersonaBadgeProps) {
  const [open, setOpen] = useState(false);
  const roleLabel = user.roles.length > 0 ? user.roles.join(', ') : 'none';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`${user.email}\nRole: ${roleLabel}`}
        data-testid="user-persona-badge"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white transition-opacity hover:opacity-90"
      >
        {initialsFor(user.email)}
      </button>

      {open && (
        <>
          {/* Same click-outside-to-close backdrop pattern already used by TabShell.tsx's API
              Keys modal - a full-screen invisible layer under the menu, closing it on any
              outside click. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" data-testid="user-persona-menu-backdrop" />
          <div
            role="menu"
            data-testid="user-persona-menu"
            className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-card border border-border bg-bg-card shadow-card-lg"
          >
            <Link
              to="/change-password"
              role="menuitem"
              onClick={() => setOpen(false)}
              data-testid="user-menu-change-password"
              className="block px-4 py-2.5 text-sm text-text-primary hover:bg-bg-primary"
            >
              Change Password
            </Link>
            <Link
              to="/security-questions"
              role="menuitem"
              onClick={() => setOpen(false)}
              data-testid="user-menu-security-questions"
              className="block px-4 py-2.5 text-sm text-text-primary hover:bg-bg-primary"
            >
              Manage Security Questions
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
