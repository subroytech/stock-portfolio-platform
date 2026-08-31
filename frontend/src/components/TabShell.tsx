import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { hasAdminConsoleAccess, useLogout, useSession } from '../api/auth';
import { ApiKeysModalContext } from '../lib/apiKeysModal';
import { TickerHandoffContext, type HandoffTarget, type TickerHandoff } from '../lib/tickerHandoff';
import UserPersonaBadge from './UserPersonaBadge';
import ImpersonationBanner from './ImpersonationBanner';
import DashboardPage from '../pages/DashboardPage';
import FlexPortfolioPage from '../pages/FlexPortfolioPage';
import MomentumPage from '../pages/MomentumPage';
import ContrarianFinderPage from '../pages/ContrarianFinderPage';
import LongTermAnalysisPage from '../pages/LongTermAnalysisPage';
import ContrarianComebackPage from '../pages/ContrarianComebackPage';
import SubscriptionsPage from '../pages/SubscriptionsPage';

const TABS = [
  { path: '/', label: 'Portfolio' },
  { path: '/long-term-analysis', label: 'Long-Term Analysis' },
  { path: '/contrarian-finder', label: 'Contrarian Finder' },
  { path: '/contrarian-comeback', label: 'Contrarian Comeback' },
  { path: '/momentum', label: 'Momentum Analysis' },
] as const;

// The one persistent component for the whole signed-in session (see App.tsx's
// single `path="/*"` route). Every tab is mounted here at all times - the URL
// only controls which one is *visible* (via CSS), never which one *exists* -
// so switching tabs never unmounts/resets a tool's in-progress state, unlike
// the previous one-route-per-tool setup where navigating away destroyed it.
export default function TabShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const logout = useLogout();
  const { data: session } = useSession();
  // Permission-based, not a hardcoded roles.includes('admin') check - a superset role like
  // admin-master holds every admin-console permission without literally being named "admin".
  const isAdmin = hasAdminConsoleAccess(session);
  // Real permission check (Admin Console Phase 8), not just "not admin" - own API key
  // management is no longer open to every signed-in user by default (api_keys:manage_own,
  // migration 018). Hidden entirely (not just disabled) when absent.
  const canManageOwnKeys = session?.permissions?.includes('api_keys:manage_own') ?? false;
  // Non-admin's API Keys entry point - SubscriptionsPage itself no longer owns any modal
  // chrome (Admin Console Phase 7: it's also embedded plain, unwrapped, as AdminPage's "My
  // API(s)" tab), so the overlay lives here instead, the only remaining caller that needs it.
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [handoff, setHandoff] = useState<TickerHandoff | null>(null);
  const requestIdRef = useRef(0);

  // Portfolio Upload - Flex (CLAUDE.md's "Portfolio Upload - Flex" section) - the Portfolio
  // tab's Legacy/Flex sub-tabs, each hidden entirely (not disabled) when the caller lacks the
  // matching Function permission, same pattern as the Admin/API Keys conditional rendering
  // above. A session with neither permission still gets a reasonable defensive-default: a
  // read-only Legacy view (no UploadImportDialog) rather than a blank Portfolio tab - the same
  // precedent ContrarianFinderPage follows for a session lacking contrarian_finder:scan.
  const canLegacy = session?.permissions?.includes('portfolio_upload:legacy') ?? false;
  const canFlex = session?.permissions?.includes('portfolio_upload:flex') ?? false;
  const [portfolioSubTab, setPortfolioSubTab] = useState<'legacy' | 'flex'>('legacy');
  const effectivePortfolioSubTab = canLegacy && canFlex ? portfolioSubTab : (canFlex && !canLegacy ? 'flex' : 'legacy');

  function launch(target: HandoffTarget, symbol: string) {
    requestIdRef.current += 1;
    setHandoff({ target, symbol, requestId: requestIdRef.current });
    navigate(`/${target}`);
  }

  return (
    <ApiKeysModalContext.Provider value={{ open: () => setShowApiKeys(true) }}>
    <TickerHandoffContext.Provider value={{ handoff, launch }}>
      <div className="min-h-screen bg-bg-primary">
        <header className="flex flex-wrap items-center gap-3 border-b border-border bg-bg-secondary px-4 py-3 shadow-card sm:px-6">
          <nav className="flex flex-wrap items-center gap-1">
            {TABS.map((tab) => {
              const active = location.pathname === tab.path;
              return (
                <Link
                  key={tab.path}
                  to={tab.path}
                  className={`rounded-btn px-3 py-1.5 text-sm font-medium transition-colors ${
                    active ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-primary'
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>

          {/* ml-auto here (not on Log out) is what keeps Admin/API Keys pinned to the
              right edge, immediately before Log out, even when this div renders empty. */}
          <div className="ml-auto flex items-center gap-3">
            {isAdmin && (
              <Link to="/admin" className="text-sm text-text-secondary hover:text-accent">
                Admin
              </Link>
            )}
            {!isAdmin && canManageOwnKeys && (
              <button
                type="button"
                onClick={() => setShowApiKeys(true)}
                className="text-sm text-text-secondary hover:text-accent"
              >
                API Keys
              </button>
            )}
          </div>

          {session && <UserPersonaBadge user={session} />}

          <button
            type="button"
            onClick={() => logout.mutate()}
            className="rounded-btn border border-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-primary"
          >
            Log out
          </button>
        </header>

        {session && <ImpersonationBanner session={session} returnPath="/admin" />}

        <div data-testid="tab-panel-portfolio" className={location.pathname === '/' ? '' : 'hidden'}>
          {canLegacy && canFlex && (
            <nav className="flex flex-wrap items-center gap-1 border-b border-border bg-bg-secondary px-4 py-2 sm:px-6">
              <button
                type="button"
                onClick={() => setPortfolioSubTab('legacy')}
                className={`rounded-btn px-3 py-1 text-sm font-medium transition-colors ${
                  effectivePortfolioSubTab === 'legacy' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-primary'
                }`}
              >
                Legacy
              </button>
              <button
                type="button"
                onClick={() => setPortfolioSubTab('flex')}
                className={`rounded-btn px-3 py-1 text-sm font-medium transition-colors ${
                  effectivePortfolioSubTab === 'flex' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-primary'
                }`}
              >
                Flex
              </button>
            </nav>
          )}
          {(canLegacy || !(canLegacy || canFlex)) && (
            <div data-testid="portfolio-subtab-legacy" className={effectivePortfolioSubTab === 'legacy' ? '' : 'hidden'}>
              <DashboardPage readOnly={!canLegacy} portfolioFilter={(p) => p.flexTemplateStatus === null} />
            </div>
          )}
          {canFlex && (
            <div data-testid="portfolio-subtab-flex" className={effectivePortfolioSubTab === 'flex' ? '' : 'hidden'}>
              <FlexPortfolioPage />
            </div>
          )}
        </div>
        <div data-testid="tab-panel-long-term-analysis" className={location.pathname === '/long-term-analysis' ? '' : 'hidden'}><LongTermAnalysisPage /></div>
        <div data-testid="tab-panel-contrarian-finder" className={location.pathname === '/contrarian-finder' ? '' : 'hidden'}><ContrarianFinderPage /></div>
        <div data-testid="tab-panel-contrarian-comeback" className={location.pathname === '/contrarian-comeback' ? '' : 'hidden'}><ContrarianComebackPage /></div>
        <div data-testid="tab-panel-momentum" className={location.pathname === '/momentum' ? '' : 'hidden'}><MomentumPage /></div>
      </div>

      {showApiKeys && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setShowApiKeys(false)}>
          <div
            className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-card bg-bg-card p-6 shadow-card-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h1 className="text-lg font-semibold text-text-primary">API Keys</h1>
              <button
                type="button"
                onClick={() => setShowApiKeys(false)}
                className="rounded-btn border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary"
              >
                Close
              </button>
            </div>
            <div className="overflow-y-auto">
              <SubscriptionsPage />
            </div>
          </div>
        </div>
      )}
    </TickerHandoffContext.Provider>
    </ApiKeysModalContext.Provider>
  );
}
