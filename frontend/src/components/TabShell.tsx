import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useLogout } from '../api/auth';
import { ApiKeysModalContext } from '../lib/apiKeysModal';
import { TickerHandoffContext, type HandoffTarget, type TickerHandoff } from '../lib/tickerHandoff';
import DashboardPage from '../pages/DashboardPage';
import MomentumPage from '../pages/MomentumPage';
import ContrarianFinderPage from '../pages/ContrarianFinderPage';
import LongTermAnalysisPage from '../pages/LongTermAnalysisPage';
import ContrarianComebackPage from '../pages/ContrarianComebackPage';
import SubscriptionsPage from '../pages/SubscriptionsPage';

const TABS = [
  { path: '/', label: 'Stock Portfolio' },
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
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [handoff, setHandoff] = useState<TickerHandoff | null>(null);
  const requestIdRef = useRef(0);

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

          <button
            type="button"
            onClick={() => setShowApiKeys(true)}
            className="ml-auto text-sm text-text-secondary hover:text-accent"
          >
            API Keys
          </button>

          <button
            type="button"
            onClick={() => logout.mutate()}
            className="rounded-btn border border-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-primary"
          >
            Log out
          </button>
        </header>

        <div data-testid="tab-panel-portfolio" className={location.pathname === '/' ? '' : 'hidden'}><DashboardPage /></div>
        <div data-testid="tab-panel-long-term-analysis" className={location.pathname === '/long-term-analysis' ? '' : 'hidden'}><LongTermAnalysisPage /></div>
        <div data-testid="tab-panel-contrarian-finder" className={location.pathname === '/contrarian-finder' ? '' : 'hidden'}><ContrarianFinderPage /></div>
        <div data-testid="tab-panel-contrarian-comeback" className={location.pathname === '/contrarian-comeback' ? '' : 'hidden'}><ContrarianComebackPage /></div>
        <div data-testid="tab-panel-momentum" className={location.pathname === '/momentum' ? '' : 'hidden'}><MomentumPage /></div>
      </div>

      {showApiKeys && <SubscriptionsPage onClose={() => setShowApiKeys(false)} />}
    </TickerHandoffContext.Provider>
    </ApiKeysModalContext.Provider>
  );
}
