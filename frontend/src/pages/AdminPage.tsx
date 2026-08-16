import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { hasAdminConsoleAccess, useSession } from '../api/auth';
import SubscriptionsPage from './SubscriptionsPage';
import MasterDataPage from './MasterDataPage';
import UserRolesPage from './UserRolesPage';
import FunctionsPage from './FunctionsPage';
import RolePermissionsPage from './RolePermissionsPage';
import RolesPage from './RolesPage';
import PortfolioTemplateApprovalPage from './PortfolioTemplateApprovalPage';

const TABS = [
  { id: 'apis', label: 'My API(s)' },
  { id: 'masterData', label: 'Master Data' },
  { id: 'users', label: 'Manage Users' },
  { id: 'functions', label: 'Manage Functions' },
  { id: 'permissions', label: 'Manage Permission' },
  { id: 'roles', label: 'Manage Role' },
  { id: 'portfolioTemplates', label: 'Portfolio Templates' },
] as const;

type TabId = (typeof TABS)[number]['id'];

// Dedicated full-screen Admin page (Admin Console Phase 7), replacing the "Admin ▾"
// dropdown-of-modals from Phases 1-5. Not nested inside TabShell - its own header/tab bar,
// reached via App.tsx's /admin route, "Back to Home" returns to TabShell's "/" tab.
export default function AdminPage() {
  const { data: session, isLoading } = useSession();
  // Permission-based, not a hardcoded roles.includes('admin') check - see api/auth.ts's
  // hasAdminConsoleAccess for why (a superset role like admin-master needs this too).
  const isAdmin = hasAdminConsoleAccess(session);
  // Real permission check (Admin Console Phase 8) - admin gets this by default from
  // migration 018, so no visible change for today's only admin; defense in depth for a
  // hypothetical future limited-admin role that reaches /admin without it.
  const canManageOwnKeys = session?.permissions?.includes('api_keys:manage_own') ?? false;
  // Same permission as Contrarian Finder's "Run Scan" - ties the two features'
  // availability together (confirmed 2026-08-02), and in practice only
  // Admin/Admin-Master ever reach this tab at all, since this whole page is
  // already gated by hasAdminConsoleAccess() above.
  const canManageMasterData = session?.permissions?.includes('contrarian_finder:scan') ?? false;
  // Portfolio Upload - Flex's approval mechanism (CLAUDE.md's "Portfolio Upload - Flex"
  // section) - hidden entirely (not disabled) for an admin session that hasn't been granted
  // this specific Function, same pattern as apis/masterData above.
  const canManagePortfolioTemplates = session?.permissions?.includes('portfolio_template:manage_status') ?? false;
  const [activeTab, setActiveTab] = useState<TabId>('apis');

  // Client-side convenience only - every proxied endpoint's own requirePermission is the
  // real enforcement, same principle as the Contrarian Finder scan button's admin check.
  if (!isLoading && session && !isAdmin) return <Navigate to="/" replace />;

  const visibleTabs = TABS.filter((tab) => {
    if (tab.id === 'apis') return canManageOwnKeys;
    if (tab.id === 'masterData') return canManageMasterData;
    if (tab.id === 'portfolioTemplates') return canManagePortfolioTemplates;
    return true;
  });

  return (
    <div className="min-h-screen bg-bg-primary">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-bg-secondary px-4 py-3 shadow-card sm:px-6">
        <Link to="/" className="text-sm text-text-secondary hover:text-accent">
          ← Back to Home
        </Link>
        <nav className="flex flex-wrap items-center gap-1">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-btn px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === tab.id ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-primary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="p-4 sm:p-6">
        {activeTab === 'apis' && canManageOwnKeys && <SubscriptionsPage />}
        {activeTab === 'masterData' && canManageMasterData && <MasterDataPage />}
        {activeTab === 'users' && <UserRolesPage />}
        {activeTab === 'functions' && <FunctionsPage />}
        {activeTab === 'permissions' && <RolePermissionsPage />}
        {activeTab === 'roles' && <RolesPage />}
        {activeTab === 'portfolioTemplates' && canManagePortfolioTemplates && <PortfolioTemplateApprovalPage />}
      </main>
    </div>
  );
}
