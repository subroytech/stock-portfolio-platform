import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { hasAdminConsoleAccess, useLogout, useSession } from '../api/auth';
import { ApiKeysModalContext } from '../lib/apiKeysModal';
import { TickerHandoffContext, type HandoffTarget, type TickerHandoff } from '../lib/tickerHandoff';
import UserPersonaBadge from './UserPersonaBadge';
import ImpersonationBanner from './ImpersonationBanner';
import SupportWidget from './SupportWidget';
import RateLimitIndicator from './RateLimitIndicator';
import RateLimitBlockedToast from './RateLimitBlockedToast';
import DashboardPage from '../pages/DashboardPage';
import FlexPortfolioPage from '../pages/FlexPortfolioPage';
import MomentumPage from '../pages/MomentumPage';
import ContrarianFinderPage from '../pages/ContrarianFinderPage';
import LongTermAnalysisPage from '../pages/LongTermAnalysisPage';
import ContrarianComebackPage from '../pages/ContrarianComebackPage';
import StockAnalysisPage from '../pages/StockAnalysisPage';
import CandlestickQuestionAnswerPage from '../pages/CandlestickQuestionAnswerPage';
import SubscriptionsPage from '../pages/SubscriptionsPage';

const TABS = [
  { path: '/', label: 'Portfolio' },
  { path: '/long-term-analysis', label: 'Long-Term Analysis' },
  { path: '/contrarian-finder', label: 'Contrarian Finder' },
  { path: '/contrarian-comeback', label: 'Contrarian Comeback' },
  { path: '/momentum', label: 'Momentum Analysis' },
] as const;

// The one persistent component for the whole signed-in session (see App.tsx's
// single `path="/*"` route). Every tab lives here, lazily mounted on first
// visit and never unmounted again after that (see visitedTabs below) - so
// switching tabs never unmounts/resets a tool's in-progress state, unlike
// the previous one-route-per-tool setup where navigating away destroyed it.
export default function TabShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const logout = useLogout();
  const { data: session, isLoading: sessionLoading } = useSession();
  // Permission-based, not a hardcoded roles.includes('admin') check - a superset role like
  // admin-master holds every admin-console permission without literally being named "admin".
  const isAdmin = hasAdminConsoleAccess(session);
  // Real permission check (Admin Console Phase 8), not just "not admin" - own API key
  // management is no longer open to every signed-in user by default (api_keys:manage_own,
  // migration 018). Hidden entirely (not just disabled) when absent.
  const canManageOwnKeys = session?.permissions?.includes('api_keys:manage_own') ?? false;
  // Combined rate limit (fmpRateLimit.service.ts) is a deliberate role-name check, not a
  // permission - admin/admin-master are unconditionally exempt from it, so the header
  // indicator/toast are never shown to them at all, not just shown-but-always-green.
  const isExemptFromRateLimit = session?.roles.includes('admin') || session?.roles.includes('admin-master') || false;
  // Non-admin's API Keys entry point - SubscriptionsPage itself no longer owns any modal
  // chrome (Admin Console Phase 7: it's also embedded plain, unwrapped, as AdminPage's "My
  // API(s)" tab), so the overlay lives here instead, the only remaining caller that needs it.
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [handoff, setHandoff] = useState<TickerHandoff | null>(null);
  const requestIdRef = useRef(0);
  // Stock Analysis's own popover (below) - open/closed state for its Candlestick Charts/
  // Tutorial menu, same click-to-toggle + outside-click-closes shape as UserPersonaBadge's menu.
  const [stockAnalysisMenuOpen, setStockAnalysisMenuOpen] = useState(false);

  // Every tab used to mount unconditionally at all times (only CSS `hidden` toggled which one was
  // visible) so switching tabs never reset a tool's in-progress state - but that also meant a
  // tab's queries fired the instant you logged in, before you ever clicked it (real bug found
  // live: Stock Analysis quadrants holding leftover tickers re-fetched on every login with zero
  // user action). visitedTabs only ever grows, so once a path is added it stays mounted for the
  // rest of the session exactly as before - this only defers the *first* mount until the user
  // actually navigates there.
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set([location.pathname]));
  useEffect(() => {
    setVisitedTabs((prev) => (prev.has(location.pathname) ? prev : new Set(prev).add(location.pathname)));
  }, [location.pathname]);

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

  // Stock Analysis tab - gated Function (migration 041), zero default grants. Hidden entirely
  // (not just disabled) from the nav when absent, same pattern as Admin/API Keys above - and
  // the first top-level tab that also needs a direct-URL guard (see the panel below), since
  // every other tab here has always been open to any signed-in session.
  const canStockAnalysis = session?.permissions?.includes('stock_analysis:view') ?? false;
  // Candlestick Pattern Q&A (Phase 1) - gated Function, zero default grants. Was a plain
  // contextual link only (moved off the top-level nav 2026-09-21) until a real gap surfaced:
  // a role granted candlestick_question_answer:ask without stock_analysis:view had no way to
  // ever reach it, since both prior entry points lived inside the Stock Analysis panel. Folded
  // back into the nav as "Stock Analysis"'s own popover entry below (a second nav row was tried
  // first and rejected live for costing a full line of vertical space on every page).
  const canCandlestickQuestionAnswer = session?.permissions?.includes('candlestick_question_answer:ask') ?? false;
  // The combined "Stock Analysis" nav entry is visible with either permission - its target
  // route depends on which one the session actually has, so an ask-only session lands
  // directly on the page it can use instead of the stock-analysis route's own guard bouncing
  // it home. "Active" covers both routes so the button stays highlighted on either sub-page.
  const canStockAnalysisGroup = canStockAnalysis || canCandlestickQuestionAnswer;
  const stockAnalysisGroupPath = canStockAnalysis ? '/stock-analysis' : '/candlestick-question-answer';
  const stockAnalysisGroupActive = location.pathname === '/stock-analysis' || location.pathname === '/candlestick-question-answer';
  // The popover (vs. a plain link) is only needed when there's an actual choice to make - a
  // session with just one of the two permissions has nothing to pick between, so it stays a
  // single direct link, same as before.
  const canStockAnalysisMenu = canStockAnalysis && canCandlestickQuestionAnswer;

  // Real bug found live 2026-09-19: launching a tab that hadn't been visited yet this session
  // (e.g. Contrarian Finder/Momentum's "LT"/"CC" row actions) silently lost the result - the
  // underlying request genuinely fired and completed, but the "Analyzing..." spinner never
  // cleared. Root cause: visitedTabs' lazy mount (above) means the target page can now mount
  // for the very first time at the *same instant* it receives the handoff, landing that mount
  // inside React StrictMode's dev-only double-invoke window - the mutation's eventual response
  // updates a component instance that's no longer the one being rendered. tickerHandoff.ts's own
  // comment ("both tabs stay mounted at all times") predates lazy mounting and is no longer true.
  // Fix: mark the target visited (mount it) in its own synchronous flush BEFORE dispatching the
  // handoff, so by the time the handoff arrives the page has already finished mounting - a plain
  // update to an already-mounted page, exactly like every tab behaved before lazy mounting
  // existed. flushSync (not e.g. setTimeout) keeps this synchronous end-to-end, matching how
  // React state updates from a click handler already behave elsewhere in this codebase.
  function launch(target: HandoffTarget, symbol: string) {
    const path = `/${target}`;
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    flushSync(() => {
      setVisitedTabs((prev) => (prev.has(path) ? prev : new Set(prev).add(path)));
    });
    setHandoff({ target, symbol, requestId });
    navigate(path);
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
            {canStockAnalysisGroup && !canStockAnalysisMenu && (
              <Link
                to={stockAnalysisGroupPath}
                className={`rounded-btn px-3 py-1.5 text-sm font-medium transition-colors ${
                  stockAnalysisGroupActive ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-primary'
                }`}
              >
                Stock Analysis
              </Link>
            )}
            {canStockAnalysisMenu && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setStockAnalysisMenuOpen((o) => !o)}
                  aria-haspopup="menu"
                  aria-expanded={stockAnalysisMenuOpen}
                  className={`rounded-btn px-3 py-1.5 text-sm font-medium transition-colors ${
                    stockAnalysisGroupActive ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-primary'
                  }`}
                >
                  Stock Analysis ▾
                </button>
                {stockAnalysisMenuOpen && (
                  <>
                    {/* Same click-outside-to-close backdrop pattern as UserPersonaBadge's menu -
                        a full-screen invisible layer under the menu, closing it on any outside
                        click. */}
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setStockAnalysisMenuOpen(false)}
                      aria-hidden="true"
                      data-testid="stock-analysis-menu-backdrop"
                    />
                    <div
                      role="menu"
                      data-testid="stock-analysis-menu"
                      className="absolute left-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-card border border-border bg-bg-card shadow-card-lg"
                    >
                      <Link
                        to="/stock-analysis"
                        role="menuitem"
                        onClick={() => setStockAnalysisMenuOpen(false)}
                        className={`block px-4 py-2.5 text-sm hover:bg-bg-primary ${
                          location.pathname === '/stock-analysis' ? 'font-semibold text-accent' : 'text-text-primary'
                        }`}
                      >
                        Candlestick Charts
                      </Link>
                      <Link
                        to="/candlestick-question-answer"
                        role="menuitem"
                        onClick={() => setStockAnalysisMenuOpen(false)}
                        className={`block px-4 py-2.5 text-sm hover:bg-bg-primary ${
                          location.pathname === '/candlestick-question-answer' ? 'font-semibold text-accent' : 'text-text-primary'
                        }`}
                      >
                        Candlestick Tutorial
                      </Link>
                    </div>
                  </>
                )}
              </div>
            )}
          </nav>

          {/* ml-auto here (not on Log out) is what keeps Admin/API Keys pinned to the
              right edge, immediately before Log out, even when this div renders empty. */}
          <div className="ml-auto flex items-center gap-3">
            {isAdmin && (
              <Link to="/admin" className="text-sm text-accent hover:underline">
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

          <SupportWidget />

          {session && !isExemptFromRateLimit && <RateLimitIndicator />}

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
        {session && !isExemptFromRateLimit && <RateLimitBlockedToast />}

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
        <div data-testid="tab-panel-long-term-analysis" className={location.pathname === '/long-term-analysis' ? '' : 'hidden'}>
          {visitedTabs.has('/long-term-analysis') && <LongTermAnalysisPage />}
        </div>
        <div data-testid="tab-panel-contrarian-finder" className={location.pathname === '/contrarian-finder' ? '' : 'hidden'}>
          {visitedTabs.has('/contrarian-finder') && <ContrarianFinderPage />}
        </div>
        <div data-testid="tab-panel-contrarian-comeback" className={location.pathname === '/contrarian-comeback' ? '' : 'hidden'}>
          {visitedTabs.has('/contrarian-comeback') && <ContrarianComebackPage />}
        </div>
        <div data-testid="tab-panel-momentum" className={location.pathname === '/momentum' ? '' : 'hidden'}>
          {visitedTabs.has('/momentum') && <MomentumPage />}
        </div>
        {/* !sessionLoading guard mirrors AdminPage.tsx's own redirect-on-no-access precedent -
            without it, a user who DOES hold stock_analysis:view would get bounced away on
            every direct visit, before the session query has even resolved. */}
        {location.pathname === '/stock-analysis' && !sessionLoading && !canStockAnalysis && <Navigate to="/" replace />}
        {location.pathname === '/candlestick-question-answer' && !sessionLoading && !canCandlestickQuestionAnswer && <Navigate to="/" replace />}
        <div data-testid="tab-panel-stock-analysis" className={location.pathname === '/stock-analysis' ? '' : 'hidden'}>
          {canStockAnalysis && visitedTabs.has('/stock-analysis') && <StockAnalysisPage />}
        </div>
        <div data-testid="tab-panel-candlestick-question-answer" className={location.pathname === '/candlestick-question-answer' ? '' : 'hidden'}>
          {canCandlestickQuestionAnswer && visitedTabs.has('/candlestick-question-answer') && <CandlestickQuestionAnswerPage />}
        </div>
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
