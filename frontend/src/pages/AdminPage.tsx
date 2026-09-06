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
import ConfigPropertiesPage from './ConfigPropertiesPage';
import AdminSupportTicketsPage from './AdminSupportTicketsPage';
import UsageAuditPage from './UsageAuditPage';
import UserPersonaBadge from '../components/UserPersonaBadge';
import ImpersonationBanner from '../components/ImpersonationBanner';
import LoginAsModal from '../components/LoginAsModal';

const TABS = [
  { id: 'apis', label: 'My API(s)' },
  { id: 'masterData', label: 'Master Data' },
  { id: 'userAttributes', label: 'Manage User Attribute' },
  { id: 'portfolioTemplates', label: 'Portfolio Templates' },
  { id: 'configProperties', label: 'Config Properties' },
  { id: 'support', label: 'Support Tickets' },
  { id: 'usageAudit', label: 'User Usage' },
] as const;

type TabId = (typeof TABS)[number]['id'];

// Admin Console UI Cleanup - Manage Users/Functions/Permission/Role collapsed from 4 flat
// top-level tabs into one "Manage User Attribute" parent, revealing these as sub-tabs -
// same sub-tab pattern TabShell.tsx already uses for Portfolio's Legacy/Flex split. Pure
// navigation regrouping - none of these 4 were ever hidden by permission (server-side
// enforcement only), and that's unchanged here.
const SUB_TABS = [
  { id: 'users', label: 'Manage Users' },
  { id: 'functions', label: 'Manage Functions' },
  { id: 'permissions', label: 'Manage Permission' },
  { id: 'roles', label: 'Manage Role' },
] as const;

type SubTabId = (typeof SUB_TABS)[number]['id'];

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
  // Config Properties (2026-08-24) - grantable only to admin-master (roles.service.ts's
  // ADMIN_MASTER_ONLY_PERMISSIONS), so this tab is invisible to every other admin session,
  // same hidden-not-disabled pattern as apis/masterData/portfolioTemplates above.
  const canManageConfigProperties = session?.permissions?.includes('config_properties:manage') ?? false;
  // Helpdesk / Support Tickets (2026-09-05) - zero default grants, same hidden-not-disabled
  // pattern as every other permission-gated tab on this page.
  const canManageSupport = session?.permissions?.includes('support:manage') ?? false;
  // User Usage Dashboard (2026-09-05) - zero default grants, same hidden-not-disabled pattern.
  const canViewUsageAudit = session?.permissions?.includes('usage_audit:view') ?? false;
  // "Login-as" (CLAUDE.md's "Login-as" section) - grantable only to admin-master
  // (roles.service.ts's ADMIN_MASTER_ONLY_PERMISSIONS), same hidden-not-disabled pattern as
  // every other permission-gated header control on this page.
  const canImpersonate = session?.permissions?.includes('users:impersonate') ?? false;
  const [activeTab, setActiveTab] = useState<TabId>('apis');
  const [activeSubTab, setActiveSubTab] = useState<SubTabId>('users');
  const [showLoginAs, setShowLoginAs] = useState(false);

  // Client-side convenience only - every proxied endpoint's own requirePermission is the
  // real enforcement, same principle as the Contrarian Finder scan button's admin check.
  if (!isLoading && session && !isAdmin) return <Navigate to="/" replace />;

  const visibleTabs = TABS.filter((tab) => {
    if (tab.id === 'apis') return canManageOwnKeys;
    if (tab.id === 'masterData') return canManageMasterData;
    if (tab.id === 'portfolioTemplates') return canManagePortfolioTemplates;
    if (tab.id === 'configProperties') return canManageConfigProperties;
    if (tab.id === 'support') return canManageSupport;
    if (tab.id === 'usageAudit') return canViewUsageAudit;
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

        {/* ml-auto pins the persona badge to the right edge, mirroring TabShell's header. */}
        <div className="ml-auto flex items-center gap-3">
          {canImpersonate && (
            <button
              type="button"
              onClick={() => setShowLoginAs(true)}
              className="text-sm text-text-secondary hover:text-accent"
            >
              Login as User
            </button>
          )}
          {session && <UserPersonaBadge user={session} />}
        </div>
      </header>

      {activeTab === 'userAttributes' && (
        <nav className="flex flex-wrap items-center gap-1 border-b border-border bg-bg-secondary px-4 py-2 sm:px-6">
          {SUB_TABS.map((subTab) => (
            <button
              key={subTab.id}
              type="button"
              onClick={() => setActiveSubTab(subTab.id)}
              className={`rounded-btn px-3 py-1 text-sm font-medium transition-colors ${
                activeSubTab === subTab.id ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-primary'
              }`}
            >
              {subTab.label}
            </button>
          ))}
        </nav>
      )}

      {session && <ImpersonationBanner session={session} returnPath="/admin" />}

      {showLoginAs && (
        <LoginAsModal onClose={() => setShowLoginAs(false)} onImpersonated={() => setShowLoginAs(false)} />
      )}

      <main className="p-4 sm:p-6">
        {activeTab === 'apis' && canManageOwnKeys && <SubscriptionsPage />}
        {activeTab === 'masterData' && canManageMasterData && <MasterDataPage />}
        {activeTab === 'userAttributes' && activeSubTab === 'users' && <UserRolesPage />}
        {activeTab === 'userAttributes' && activeSubTab === 'functions' && <FunctionsPage />}
        {activeTab === 'userAttributes' && activeSubTab === 'permissions' && <RolePermissionsPage />}
        {activeTab === 'userAttributes' && activeSubTab === 'roles' && <RolesPage />}
        {activeTab === 'portfolioTemplates' && canManagePortfolioTemplates && <PortfolioTemplateApprovalPage />}
        {activeTab === 'configProperties' && canManageConfigProperties && <ConfigPropertiesPage />}
        {activeTab === 'support' && canManageSupport && <AdminSupportTicketsPage />}
        {activeTab === 'usageAudit' && canViewUsageAudit && <UsageAuditPage />}
      </main>
    </div>
  );
}
