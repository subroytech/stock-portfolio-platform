import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import { ApiError } from '../api/client';
import ContrarianComebackPage from './ContrarianComebackPage';
import type {
  ContrarianComebackGateResult,
  ContrarianComebackSubmitResult,
  FundamentalHealth,
  CatalystPipeline,
  StagedEntry,
  RecoveryTargets,
  ValueDislocation,
} from '../api/contrarianComeback';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ContrarianComebackPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function baseGate(overrides: Partial<ContrarianComebackGateResult> = {}): ContrarianComebackGateResult {
  return {
    symbol: 'AAPL',
    check1Pass: true,
    drawdownPct: 30,
    dd52w: 30,
    dd4y: 20,
    check3Status: 'pass',
    etfSymbol: 'XLK',
    etfReturn6M: 3,
    check4Pass: true,
    recentNews: [],
    insiderSignal: 'Neutral',
    insiderBuys: 0,
    insiderSells: 0,
    analystUpgrades90d: 0,
    analystDowngrades90d: 0,
    priceTargetAvg: null,
    analystUpsidePct: null,
    failedCheck: null,
    reason: null,
    route: null,
    ...overrides,
  };
}

function baseFundamentalHealth(overrides: Partial<FundamentalHealth> = {}): FundamentalHealth {
  return {
    debtToEquity: { value: 1.0, tier: 'green' },
    currentRatio: { value: 1.5, tier: 'green' },
    freeCashFlow: { value: 100, tier: 'green' },
    revenueGrowthPct: { value: 12, tier: 'green' },
    grossMarginPct: { value: 45, tier: 'green' },
    cashRunwayMonths: { value: null, tier: null },
    positiveFcf: true,
    ...overrides,
  };
}

function baseCatalystPipeline(overrides: Partial<CatalystPipeline> = {}): CatalystPipeline {
  return {
    recentInsiderTrades: [],
    recentGrades: [],
    news: [],
    insiderSignal: 'Neutral',
    analystUpgrades90d: 0,
    ...overrides,
  };
}

function baseValueDislocation(overrides: Partial<ValueDislocation> = {}): ValueDislocation {
  return {
    peRatio: 22.5,
    priceToSales: 4.2,
    analystUpsidePct: 29.1,
    sanityCheckTriggered: false,
    ...overrides,
  };
}

function baseStagedEntry(overrides: Partial<StagedEntry> = {}): StagedEntry {
  return {
    tranches: [
      { label: 'T1', sizePct: 40, priceLow: 145.5, priceHigh: 154.5, trigger: 'Exhaustion signals present' },
      { label: 'T2', sizePct: 35, priceLow: 157.5, priceHigh: 177, trigger: 'Bottoming pattern confirming' },
      { label: 'T3', sizePct: 25, priceLow: 114, priceHigh: 126, trigger: 'Early recovery confirmed' },
    ],
    hardStop: 127.5,
    capLabel: 'Large-Cap',
    isMidCap: false,
    ...overrides,
  };
}

function baseRecoveryTargets(overrides: Partial<RecoveryTargets> = {}): RecoveryTargets {
  return {
    conservative: { label: 'Conservative', horizon: '12M', price: 120, returnPct: -20 },
    baseCase: { label: 'Base Case', horizon: '18M', price: 160, returnPct: 6.7 },
    bullCase: { label: 'Bull Case', horizon: '24M', price: 200, returnPct: 33.3 },
    analystConsensus: null,
    riskRewardRatio: null,
    ...overrides,
  };
}

function baseSubmit(overrides: Partial<ContrarianComebackSubmitResult> = {}): ContrarianComebackSubmitResult {
  return {
    symbol: 'AAPL',
    format: 'A',
    failedCheck: null,
    reason: null,
    route: null,
    companyName: 'Apple Inc.',
    sector: 'Technology',
    exchange: 'NASDAQ',
    price: 150,
    drawdownPct: 30,
    breakdownTypes: ['event'],
    hybridCap: false,
    check3Override: false,
    check3OverrideReason: null,
    etfSymbol: 'XLK',
    etfReturn6M: 3,
    score: {
      breakdown: 1, sector: 2, technical: 0, value: 1, catalyst: 0, total: 4,
      verdict: 'SPECULATIVE', hybridCapActive: false, sectorOverrideCapActive: false,
      hints: {
        breakdown: '30.0% drawdown', sector: 'Sector ETF +3.0% over 6 months',
        technical: 'Weekly RSI 38.0 — not yet oversold', value: 'Analyst upside +29.1%',
        catalyst: 'No insider buying or analyst upgrades detected (90d)',
      },
    },
    technicals: { weeklyRsi: 38, obvTrend: 'flat', volumeDrying: false, sma200w: 140, volumeRatioPct: 105, volumeClimax: false },
    fibonacci: { swingLow: 100, athPrice: 200, fib382: 138, fib618: 162, fib100: 200 },
    fundamentalHealth: baseFundamentalHealth(),
    catalystPipeline: baseCatalystPipeline(),
    stagedEntry: baseStagedEntry(),
    recoveryTargets: baseRecoveryTargets(),
    valueDislocation: baseValueDislocation(),
    ...overrides,
  };
}

describe('ContrarianComebackPage', () => {
  test('checking eligibility renders the gate summary and the checkbox form when no auto-check fails', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue(baseGate());
    renderPage();

    await userEvent.type(screen.getByLabelText('Ticker'), 'aapl');
    await userEvent.click(screen.getByRole('button', { name: /check eligibility/i }));

    expect(await screen.findByText(/Check 1 — Drawdown/)).toBeInTheDocument();
    expect(client.apiFetch).toHaveBeenCalledWith('/analysis/contrarian-comeback/AAPL/gate');
    expect(screen.getByText('Event-Driven')).toBeInTheDocument(); // breakdown type checkbox
    expect(screen.getByRole('button', { name: /confirm & run full analysis/i })).toBeDisabled();
  });

  test('gate failure renders the rejection card immediately, with no checkbox form', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue(baseGate({
      check1Pass: false, failedCheck: 'Check 1 — Drawdown Severity', reason: 'Not enough drawdown.', route: 'Momentum Trading Skill',
    }));
    renderPage();

    await userEvent.type(screen.getByLabelText('Ticker'), 'AAPL');
    await userEvent.click(screen.getByRole('button', { name: /check eligibility/i }));

    expect(await screen.findByText('No Contrarian Opportunity Detected')).toBeInTheDocument();
    expect(screen.getByText('Check 1 — Drawdown Severity')).toBeInTheDocument();
    expect(screen.queryByText('Event-Driven')).not.toBeInTheDocument();
  });

  test('confirm button only enables once a breakdown type and a catalyst answer are both chosen', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue(baseGate());
    renderPage();
    await userEvent.type(screen.getByLabelText('Ticker'), 'AAPL');
    await userEvent.click(screen.getByRole('button', { name: /check eligibility/i }));
    await screen.findByText('Event-Driven');

    const confirmBtn = screen.getByRole('button', { name: /confirm & run full analysis/i });
    expect(confirmBtn).toBeDisabled();

    await userEvent.click(screen.getByText('Event-Driven'));
    expect(confirmBtn).toBeDisabled(); // still missing catalyst answer

    await userEvent.click(screen.getByText(/Yes — at least one identifiable catalyst/));
    expect(confirmBtn).not.toBeDisabled();
  });

  test('the Check-3 override UI only appears when the gate reports it as available', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue(baseGate({ check3Status: 'pass' }));
    renderPage();
    await userEvent.type(screen.getByLabelText('Ticker'), 'AAPL');
    await userEvent.click(screen.getByRole('button', { name: /check eligibility/i }));
    await screen.findByText('Event-Driven');

    expect(screen.queryByText(/Override sector check/)).not.toBeInTheDocument();
  });

  test('the Check-3 override UI appears and gates submission when overrideAvailable is true', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue(baseGate({ check3Status: 'override_available', etfReturn6M: -10 }));
    renderPage();
    await userEvent.type(screen.getByLabelText('Ticker'), 'AAPL');
    await userEvent.click(screen.getByRole('button', { name: /check eligibility/i }));
    await screen.findByText(/Override sector check/);

    await userEvent.click(screen.getByText('Event-Driven'));
    await userEvent.click(screen.getByText(/Yes — at least one identifiable catalyst/));
    const confirmBtn = screen.getByRole('button', { name: /confirm & run full analysis/i });
    expect(confirmBtn).toBeDisabled(); // override checkbox not yet checked

    await userEvent.click(screen.getByLabelText(/Override sector check/));
    expect(confirmBtn).toBeDisabled(); // reason not yet selected

    await userEvent.selectOptions(screen.getByRole('combobox'), 'macro');
    expect(confirmBtn).not.toBeDisabled();
  });

  test('submitting posts the answers and renders the Format A score/verdict', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) =>
      url.endsWith('/gate') ? Promise.resolve(baseGate()) : Promise.resolve(baseSubmit()),
    );
    renderPage();
    await userEvent.type(screen.getByLabelText('Ticker'), 'AAPL');
    await userEvent.click(screen.getByRole('button', { name: /check eligibility/i }));
    await screen.findByText('Event-Driven');

    await userEvent.click(screen.getByText('Event-Driven'));
    await userEvent.click(screen.getByText(/Yes — at least one identifiable catalyst/));
    await userEvent.click(screen.getByRole('button', { name: /confirm & run full analysis/i }));

    expect(await screen.findByText('SPECULATIVE')).toBeInTheDocument();
    expect(screen.getByText('4/10')).toBeInTheDocument();
    expect(client.apiFetch).toHaveBeenCalledWith('/analysis/contrarian-comeback/AAPL', {
      method: 'POST',
      body: JSON.stringify({ breakdownTypes: ['event'], catalystAnswer: 'yes', check3Override: false, check3OverrideReason: undefined }),
    });
  });

  test('submitting a "no catalyst" answer renders the Format B rejection card', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) =>
      url.endsWith('/gate')
        ? Promise.resolve(baseGate())
        : Promise.resolve(baseSubmit({ format: 'B', failedCheck: 'Check 5 — Recovery Catalyst', reason: 'No catalyst.', route: 'Monitor and re-run.', score: null })),
    );
    renderPage();
    await userEvent.type(screen.getByLabelText('Ticker'), 'AAPL');
    await userEvent.click(screen.getByRole('button', { name: /check eligibility/i }));
    await screen.findByText('Event-Driven');

    await userEvent.click(screen.getByText('Event-Driven'));
    await userEvent.click(screen.getByText(/No — no visible recovery path/));
    await userEvent.click(screen.getByRole('button', { name: /confirm & run full analysis/i }));

    expect(await screen.findByText('Check 5 — Recovery Catalyst')).toBeInTheDocument();
  });

  test('missing FMP key shows a 503 message with a button to add one', async () => {
    vi.spyOn(client, 'apiFetch').mockRejectedValue(new ApiError(503, 'No fmp API key on file.', null));
    renderPage();
    await userEvent.type(screen.getByLabelText('Ticker'), 'AAPL');
    await userEvent.click(screen.getByRole('button', { name: /check eligibility/i }));

    expect(await screen.findByText('No fmp API key on file.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add your fmp api key/i })).toBeInTheDocument();
  });

  async function runToFormatAResult(submitOverrides: Partial<ContrarianComebackSubmitResult> = {}) {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) =>
      url.endsWith('/gate') ? Promise.resolve(baseGate()) : Promise.resolve(baseSubmit(submitOverrides)),
    );
    renderPage();
    await userEvent.type(screen.getByLabelText('Ticker'), 'AAPL');
    await userEvent.click(screen.getByRole('button', { name: /check eligibility/i }));
    await screen.findByText('Event-Driven');
    await userEvent.click(screen.getByText('Event-Driven'));
    await userEvent.click(screen.getByText(/Yes — at least one identifiable catalyst/));
    await userEvent.click(screen.getByRole('button', { name: /confirm & run full analysis/i }));
    await screen.findByText('Fundamental Health');
  }

  test('Fundamental Health renders tier pills for green/yellow/red, and a dash with no pill for a null metric', async () => {
    await runToFormatAResult({
      fundamentalHealth: baseFundamentalHealth({
        debtToEquity: { value: 1.0, tier: 'green' },
        currentRatio: { value: 1.0, tier: 'yellow' },
        grossMarginPct: { value: 10, tier: 'red' },
        freeCashFlow: { value: null, tier: null },
        positiveFcf: false,
      }),
    });

    expect(screen.getAllByText('green').length).toBeGreaterThan(0);
    expect(screen.getByText('yellow')).toBeInTheDocument();
    expect(screen.getByText('red')).toBeInTheDocument();
    // Free Cash Flow row: null value renders as a dash, no tier pill next to it.
    const fcfRow = screen.getByText('Free Cash Flow').closest('div');
    expect(fcfRow).toHaveTextContent('—');
  });

  test('Cash Runway shows "Positive FCF" instead of a null runway number when FCF is positive', async () => {
    await runToFormatAResult({
      fundamentalHealth: baseFundamentalHealth({ cashRunwayMonths: { value: null, tier: null }, positiveFcf: true }),
    });
    expect(screen.getByText('Positive FCF')).toBeInTheDocument();
  });

  test('Volume Climax row always renders, showing "None detected" when false', async () => {
    await runToFormatAResult({
      technicals: { weeklyRsi: 38, obvTrend: 'flat', volumeDrying: false, sma200w: 140, volumeRatioPct: 105, volumeClimax: false },
    });
    expect(screen.getByText('None detected')).toBeInTheDocument();
  });

  test('Volume Climax row shows "Spike detected" when true', async () => {
    await runToFormatAResult({
      technicals: { weeklyRsi: 38, obvTrend: 'flat', volumeDrying: false, sma200w: 140, volumeRatioPct: 210, volumeClimax: true },
    });
    expect(screen.getByText(/Spike detected/)).toBeInTheDocument();
  });

  test('Catalyst Pipeline news list shows a "show more" toggle beyond 5 headlines', async () => {
    const news = Array.from({ length: 7 }, (_, i) => ({ date: '2026-07-01', title: `Headline ${i}`, source: 'Reuters', url: null }));
    await runToFormatAResult({ catalystPipeline: baseCatalystPipeline({ news }) });

    expect(screen.getByText('Headline 0')).toBeInTheDocument();
    expect(screen.queryByText('Headline 6')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /show 2 more headlines/i }));
    expect(screen.getByText('Headline 6')).toBeInTheDocument();
  });

  test('Value Trap Check counter updates and shows a warning banner at 2 or more checked', async () => {
    await runToFormatAResult();

    expect(screen.getByText('0 of 7')).toBeInTheDocument();
    expect(screen.queryByText(/Value trap threshold met/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Serial guidance-cutter'));
    expect(screen.getByText('1 of 7')).toBeInTheDocument();
    expect(screen.queryByText(/Value trap threshold met/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Shrinking addressable market'));
    expect(screen.getByText('2 of 7')).toBeInTheDocument();
    expect(screen.getByText(/Value trap threshold met/)).toBeInTheDocument();
  });

  test('Staged Entry Plan renders tranche price ranges and the hard stop', async () => {
    await runToFormatAResult();

    expect(screen.getByText('$145.50 – $154.50')).toBeInTheDocument(); // T1
    expect(screen.getByText('$157.50 – $177.00')).toBeInTheDocument(); // T2
    expect(screen.getByText('$114.00 – $126.00')).toBeInTheDocument(); // T3
    expect(screen.getByText('$127.50')).toBeInTheDocument(); // hard stop
  });

  test('Staged Entry mid-cap liquidity note only shows when isMidCap is true', async () => {
    await runToFormatAResult({ stagedEntry: baseStagedEntry({ isMidCap: false }) });
    expect(screen.queryByText(/Check average daily dollar volume/)).not.toBeInTheDocument();
  });

  test('Staged Entry mid-cap liquidity note shows when isMidCap is true', async () => {
    await runToFormatAResult({ stagedEntry: baseStagedEntry({ isMidCap: true, capLabel: 'Mid-Cap' }) });
    expect(screen.getByText(/Check average daily dollar volume/)).toBeInTheDocument();
  });

  test('Recovery Targets analyst-consensus row absent when null', async () => {
    await runToFormatAResult({ recoveryTargets: baseRecoveryTargets({ analystConsensus: null }) });
    expect(screen.queryByText('Analyst Consensus')).not.toBeInTheDocument();
  });

  test('Recovery Targets analyst-consensus row and R:R ratio render when present', async () => {
    await runToFormatAResult({
      recoveryTargets: baseRecoveryTargets({ analystConsensus: { low: 140, high: 180, average: 160, returnPct: 6.7 }, riskRewardRatio: 2.5 }),
    });
    expect(screen.getByText('Analyst Consensus')).toBeInTheDocument();
    expect(screen.getByText('2.5 : 1')).toBeInTheDocument();
  });

  test('Thesis Invalidation checklist interpolates the mapped sector ETF symbol', async () => {
    await runToFormatAResult({ etfSymbol: 'XLY' });
    expect(screen.getByText(/Sector ETF \(XLY\) breaks into sustained downtrend/)).toBeInTheDocument();
  });

  test('header stats are absent before any result exists', () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue(baseGate());
    renderPage();
    expect(screen.queryByText('Current Price')).not.toBeInTheDocument();
  });

  test('header stats render next to the ticker form once a Format A result exists', async () => {
    await runToFormatAResult();
    expect(screen.getByText('Current Price')).toBeInTheDocument();
    expect(screen.getByText('AAPL')).toBeInTheDocument();
  });

  test('Contrarian Score shows a "why" hint line under each factor', async () => {
    await runToFormatAResult();
    expect(screen.getByText('30.0% drawdown')).toBeInTheDocument();
    expect(screen.getByText('Sector ETF +3.0% over 6 months')).toBeInTheDocument();
    expect(screen.getByText('Weekly RSI 38.0 — not yet oversold')).toBeInTheDocument();
    expect(screen.getByText('Analyst upside +29.1%')).toBeInTheDocument();
    expect(screen.getByText('No insider buying or analyst upgrades detected (90d)')).toBeInTheDocument();
  });

  test('Value Dislocation shows PE/PS/upside with the correct qualifying pill', async () => {
    await runToFormatAResult({ valueDislocation: baseValueDislocation({ peRatio: 22.5, priceToSales: 4.2, analystUpsidePct: 47.3, sanityCheckTriggered: false }) });
    expect(screen.getByText('22.5×')).toBeInTheDocument();
    expect(screen.getByText('4.2×')).toBeInTheDocument();
    expect(screen.getByText('+47.3%')).toBeInTheDocument();
    expect(screen.getByText('Qualifies for 2/2 (>40%)')).toBeInTheDocument();
  });

  test('Value Dislocation shows the sanity-check-failed pill when PE is too high', async () => {
    await runToFormatAResult({ valueDislocation: baseValueDislocation({ peRatio: 71.0, sanityCheckTriggered: true }) });
    expect(screen.getByText('High (>60)')).toBeInTheDocument();
    expect(screen.getByText('Value score forced to 0')).toBeInTheDocument();
  });

  test('Catalyst Pipeline shows the insider signal / upgrade count summary and color-codes rows', async () => {
    await runToFormatAResult({
      catalystPipeline: baseCatalystPipeline({
        insiderSignal: 'Net Buying',
        analystUpgrades90d: 2,
        recentInsiderTrades: [
          { transactionDate: '2026-07-01', transactionType: 'P-Purchase', acquisitionOrDisposition: 'A', securitiesTransacted: 1000, price: 50, reportingName: 'Jane Doe' },
        ],
        recentGrades: [
          { gradingCompany: 'Firm A', newGrade: 'Buy', action: 'upgrade', date: '2026-07-01' },
        ],
      }),
    });

    expect(screen.getByText('Net Buying')).toBeInTheDocument();
    expect(screen.getByText('2 analyst upgrade(s) (90d)')).toBeInTheDocument();
    expect(screen.getByText('P-Purchase')).toHaveClass('text-success');
    expect(screen.getByText('upgrade')).toHaveClass('text-success');
  });

  test('Insider Activity type cell explains the specific SEC transaction code on hover', async () => {
    await runToFormatAResult({
      catalystPipeline: baseCatalystPipeline({
        recentInsiderTrades: [
          { transactionDate: '2026-07-01', transactionType: 'M-Exempt', acquisitionOrDisposition: 'A', securitiesTransacted: 500, price: 0, reportingName: 'Jane Doe' },
          { transactionDate: '2026-07-01', transactionType: 'F-InKind', acquisitionOrDisposition: 'D', securitiesTransacted: 200, price: 50, reportingName: 'Jane Doe' },
        ],
      }),
    });

    expect(screen.getByText('M-Exempt')).toHaveAttribute('title', expect.stringContaining('Exercise of a previously granted option'));
    expect(screen.getByText('F-InKind')).toHaveAttribute('title', expect.stringContaining('withheld "in kind"'));
  });
});
