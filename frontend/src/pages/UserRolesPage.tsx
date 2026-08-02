import { useState, type FormEvent } from 'react';
import { useRoles, type Role } from '../api/roles';
import {
  useCreateUser, useUpdateUser, useUsersWithRoles, type UpdateUserInput, type UserStatus, type UserWithRoles,
} from '../api/users';
import { ApiError } from '../api/client';

const STATUSES: UserStatus[] = ['active', 'deactivated', 'cancelled', 'pending'];

interface UserRowProps {
  user: UserWithRoles;
  roles: Role[] | undefined;
}

// Edit-then-save per user row: local draft state for email/password/status/role, committed
// via one consolidated PUT /users/:id (Admin Console Phase 7) only when Save is clicked.
// Password always starts blank and is only included in the request if the admin actually
// typed something - never pre-filled, never sent empty.
function UserRow({ user, roles }: UserRowProps) {
  const updateUser = useUpdateUser();
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<UserStatus>(user.status);
  const [role, setRole] = useState(user.roles[0] ?? '');
  const [error, setError] = useState<string | null>(null);

  const currentRole = user.roles[0] ?? '';
  const dirty = email !== user.email || password.trim() !== '' || status !== user.status || role !== currentRole;

  async function handleSave() {
    setError(null);
    const fields: UpdateUserInput = { userId: user.id };
    if (email !== user.email) fields.email = email;
    if (password.trim()) fields.password = password;
    if (status !== user.status) fields.status = status;
    if (role !== currentRole) fields.role = role;
    try {
      await updateUser.mutateAsync(fields);
      setPassword('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update user.');
    }
  }

  return (
    <div className="rounded-card bg-bg-card p-3 shadow-card">
      {/* Below sm: stacked (each field its own line, easier to tap/read on a phone).
          sm and up (tablet/workstation): one line - every field shares the row, email/
          password flex to fill remaining space, selects/button stay a fixed compact width. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-nowrap sm:items-center sm:gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label={`Email for ${user.email}`}
          className="min-w-0 rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary sm:flex-1"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Leave blank to keep unchanged"
          aria-label={`Password for ${user.email}`}
          className="min-w-0 rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary sm:flex-1"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as UserStatus)}
          aria-label={`Status for ${user.email}`}
          className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary sm:w-32 sm:flex-none"
        >
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          aria-label={`Role for ${user.email}`}
          className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary sm:w-44 sm:flex-none"
        >
          {!role && <option value="" disabled>Select a role</option>}
          {roles?.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
        </select>

        <p className="text-sm text-text-secondary sm:w-36 sm:flex-none sm:truncate" title={`API keys: ${user.apiKeyProviders.length > 0 ? user.apiKeyProviders.join(', ') : 'none'}`}>
          API keys: {user.apiKeyProviders.length > 0 ? user.apiKeyProviders.join(', ') : 'none'}
        </p>

        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || updateUser.isPending}
          className="rounded-btn bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60 sm:w-20 sm:flex-none"
        >
          Save
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

// Manage Users tab content (Admin Console Phase 7, was "View/Edit User Role" through Phase
// 2, gained Create User in Phase 6). setUserRole (backend/src/services/roles.service.ts)
// enforces single-role-per-user, so each row edits one role, not a multi-select.
export default function UserRolesPage() {
  const { data: users, isLoading } = useUsersWithRoles();
  const { data: roles } = useRoles();
  const createUser = useCreateUser();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newStatus, setNewStatus] = useState<UserStatus>('active');
  const [newRole, setNewRole] = useState('user');

  // Client-side only, same pattern as FunctionsPage's status filter - the full list is
  // already fetched, so narrowing the view doesn't need a separate request.
  const [emailFilter, setEmailFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<UserStatus | 'all'>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const visibleUsers = users?.filter((user) => {
    if (emailFilter.trim() && !user.email.toLowerCase().includes(emailFilter.trim().toLowerCase())) return false;
    if (statusFilter !== 'all' && user.status !== statusFilter) return false;
    if (roleFilter !== 'all' && !user.roles.includes(roleFilter)) return false;
    return true;
  });

  async function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    try {
      await createUser.mutateAsync({ email: email.trim(), password, status: newStatus, role: newRole });
      setEmail('');
      setPassword('');
      setNewStatus('active');
      setNewRole('user');
    } catch {
      // error surfaced via createUser.isError below
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleCreateSubmit} className="flex flex-col gap-2 border-b border-border pb-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            aria-label="New user email"
            className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="New user password"
            className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value as UserStatus)}
            aria-label="New user status"
            className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            aria-label="New user role"
            className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
          >
            {roles?.map((role) => <option key={role.id} value={role.name}>{role.name}</option>)}
          </select>
          <button
            type="submit"
            disabled={createUser.isPending || !email.trim() || !password.trim()}
            className="ml-auto rounded-btn bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60"
          >
            Create user
          </button>
        </div>
        {createUser.isError && (
          <p className="text-sm text-danger">
            {createUser.error instanceof ApiError ? createUser.error.message : 'Could not create user.'}
          </p>
        )}
      </form>

      {/* Column header, matching each row's field widths - only shown at sm and up
          (tablet/workstation), where rows are one line; mobile stays stacked/label-less.
          Sticky so it stays visible while a long user list scrolls underneath it. Email/
          Status/Role columns double as live filter controls - Password/API Keys/Save have
          nothing to filter on, so they keep plain text labels. */}
      <div className="sticky top-0 z-10 hidden rounded-card bg-bg-secondary px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-secondary shadow-card sm:flex sm:flex-nowrap sm:items-center sm:gap-2">
        <input
          type="text"
          value={emailFilter}
          onChange={(e) => setEmailFilter(e.target.value)}
          placeholder="Search email…"
          aria-label="Filter by email"
          className="min-w-0 rounded-btn border border-border bg-bg-primary px-2 py-1 text-xs font-normal normal-case tracking-normal text-text-primary sm:flex-1"
        />
        <span className="sm:flex-1">Password</span>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as UserStatus | 'all')}
          aria-label="Filter by status"
          className="rounded-btn border border-border bg-bg-primary px-2 py-1 text-xs font-normal normal-case tracking-normal text-text-primary sm:w-32 sm:flex-none"
        >
          <option value="all">Status: All</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label="Filter by role"
          className="rounded-btn border border-border bg-bg-primary px-2 py-1 text-xs font-normal normal-case tracking-normal text-text-primary sm:w-44 sm:flex-none"
        >
          <option value="all">Role: All</option>
          {roles?.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
        </select>
        <span className="sm:w-36 sm:flex-none">API Keys</span>
        <span className="sm:w-20 sm:flex-none">Save</span>
      </div>

      <div className="flex flex-col gap-2">
        {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
        {visibleUsers?.map((user) => <UserRow key={user.id} user={user} roles={roles} />)}
      </div>
    </div>
  );
}
