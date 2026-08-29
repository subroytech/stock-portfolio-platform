import type { User } from '../api/auth';

interface UserPersonaBadgeProps {
  user: User;
}

// Initials from the email's local-part (before @) - first two letters, uppercased. No display
// name exists anywhere in this schema (users only ever has email), so this is the only
// identifying text short enough for a seal.
function initialsFor(email: string): string {
  const localPart = email.split('@')[0] ?? email;
  return localPart.slice(0, 2).toUpperCase();
}

// "Who is logged in" persona seal, shown in both TabShell's and AdminPage's headers. Full
// detail (email + role(s)) on hover via the plain `title` attribute - this codebase's
// already-established tooltip convention (no custom tooltip component exists anywhere).
export default function UserPersonaBadge({ user }: UserPersonaBadgeProps) {
  const roleLabel = user.roles.length > 0 ? user.roles.join(', ') : 'none';
  return (
    <span
      title={`${user.email}\nRole: ${roleLabel}`}
      data-testid="user-persona-badge"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white"
    >
      {initialsFor(user.email)}
    </span>
  );
}
