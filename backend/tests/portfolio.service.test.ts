jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/marketData.service');
// Partial mock (keeps the real MissingUserApiKeyError class, so `instanceof`
// checks in tests below are against the real thing, not an automocked
// stand-in) — only getDecryptedKey itself is replaced.
jest.mock('../src/services/userSubscription.service', () => ({
  ...jest.requireActual('../src/services/userSubscription.service'),
  getDecryptedKey: jest.fn(),
}));

import { pool } from '../src/db/pool';
import * as marketData from '../src/services/marketData.service';
import * as userSubscription from '../src/services/userSubscription.service';
import {
  listPortfolios, createPortfolio, getPortfolio, updatePortfolio, deletePortfolio,
  importHoldings, refreshPrices, PortfolioNotFoundError, PortfolioNameConflictError,
} from '../src/services/portfolio.service';
import { ParseResult, HoldingEntry } from '../src/services/parser.service';

const mockQuery = pool.query as unknown as jest.Mock;
const mockConnect = pool.connect as unknown as jest.Mock;
const mockGetQuotes = marketData.getQuotes as jest.Mock;
const mockGetHistorical = marketData.getHistorical as jest.Mock;
const mockGetDecryptedKey = userSubscription.getDecryptedKey as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
  mockGetQuotes.mockReset();
  mockGetHistorical.mockReset();
  mockGetHistorical.mockResolvedValue([]); // refreshPrices now also fetches history in parallel - most tests here don't care about it
  mockGetDecryptedKey.mockReset();
  mockGetDecryptedKey.mockResolvedValue('fake-fmp-key'); // refreshPrices tests: real key resolution isn't under test here
});

describe('listPortfolios', () => {
  test('maps DB rows to camelCase', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: '1', name: 'Fidelity', broker: 'Fidelity', created_at: 't1', updated_at: 't2' }] });
    const result = await listPortfolios('user-1');
    expect(result).toEqual([{ id: '1', name: 'Fidelity', broker: 'Fidelity', createdAt: 't1', updatedAt: 't2' }]);
  });
});

describe('createPortfolio', () => {
  test('inserts and returns the new portfolio', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: '1', name: 'Fidelity', broker: null, created_at: 't1', updated_at: 't1' }] });
    const result = await createPortfolio('user-1', 'Fidelity', null);
    expect(result.name).toBe('Fidelity');
  });

  test('translates a unique violation (code 23505) into PortfolioNameConflictError', async () => {
    mockQuery.mockRejectedValue({ code: '23505' });
    await expect(createPortfolio('user-1', 'Fidelity', null)).rejects.toBeInstanceOf(PortfolioNameConflictError);
  });
});

describe('getPortfolio', () => {
  test('returns null when not found or not owned', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getPortfolio('user-1', 'nope')).toBeNull();
  });

  test('returns full detail with computed aggregates', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: '1', name: 'Fidelity', broker: null, created_at: 't1', updated_at: 't1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'h1', symbol: 'AAPL', name: 'Apple', quantity: '10', purchase_price: '100', current_price: '120',
          sector: 'Tech', purchase_date: null, cost_basis: '1000', current_value: '1200', gain_loss: '200',
          return_pct: '20', allocation_pct: null, price_updated_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ amount: '500' }] });

    const result = await getPortfolio('user-1', '1');
    expect(result?.totalHoldingsValue).toBe(1200);
    expect(result?.totalCostBasis).toBe(1000);
    expect(result?.totalGainLoss).toBe(200);
    expect(result?.cashAmount).toBe(500);
    expect(result?.totalPortfolioValue).toBe(1700);
  });

  test('returns todayChangeDollar/todayChangePercent from tx_holdings (DB-persisted, not just the refresh-prices mutation response)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: '1', name: 'Fidelity', broker: null, created_at: 't1', updated_at: 't1' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'h1', symbol: 'AAPL', name: 'Apple', quantity: '10', purchase_price: '100', current_price: '120',
            sector: 'Tech', purchase_date: null, cost_basis: '1000', current_value: '1200', gain_loss: '200',
            return_pct: '20', allocation_pct: null, price_updated_at: '2026-07-20T10:00:00Z',
            today_change_dollar: '15.5', today_change_percent: '1.25',
          },
          {
            id: 'h2', symbol: 'MSFT', name: 'Microsoft', quantity: '5', purchase_price: '200', current_price: '200',
            sector: 'Tech', purchase_date: null, cost_basis: '1000', current_value: '1000', gain_loss: '0',
            return_pct: '0', allocation_pct: null, price_updated_at: null,
            today_change_dollar: null, today_change_percent: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getPortfolio('user-1', '1');
    const aapl = result?.holdings.find((h) => h.symbol === 'AAPL');
    const msft = result?.holdings.find((h) => h.symbol === 'MSFT');
    expect(aapl?.todayChangeDollar).toBe(15.5);
    expect(aapl?.todayChangePercent).toBe(1.25);
    expect(msft?.todayChangeDollar).toBeNull(); // never refreshed
    expect(msft?.todayChangePercent).toBeNull();
  });

  test('cashAmount defaults to 0 when there is no cash_positions row', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: '1', name: 'Fidelity', broker: null, created_at: 't1', updated_at: 't1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await getPortfolio('user-1', '1');
    expect(result?.cashAmount).toBe(0);
  });
});

describe('updatePortfolio', () => {
  test('returns null when not found or not owned', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await updatePortfolio('user-1', 'nope', { name: 'New Name' })).toBeNull();
  });

  test('translates a unique violation into PortfolioNameConflictError', async () => {
    mockQuery.mockRejectedValue({ code: '23505' });
    await expect(updatePortfolio('user-1', '1', { name: 'Taken' })).rejects.toBeInstanceOf(PortfolioNameConflictError);
  });
});

describe('deletePortfolio', () => {
  test('returns true when a row was deleted', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: '1' }] });
    expect(await deletePortfolio('user-1', '1')).toBe(true);
  });

  test('returns false when nothing matched', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await deletePortfolio('user-1', '1')).toBe(false);
  });
});

// --- importHoldings: the diff/action-hist logic is the highest-value surface here ---

interface MockClientOptions {
  ownerFound?: boolean;
  existingHoldings?: { symbol: string; quantity: string; current_price: string }[];
  uploadId?: string;
}

function makeMockClient({ ownerFound = true, existingHoldings = [], uploadId = 'upload-1' }: MockClientOptions = {}) {
  const query = jest.fn((sql: string) => {
    if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) return Promise.resolve({});
    if (sql.includes('SELECT id FROM tx_portfolios')) return Promise.resolve({ rows: ownerFound ? [{ id: 'portfolio-1' }] : [] });
    if (sql.includes('SELECT symbol, quantity, current_price FROM tx_holdings')) return Promise.resolve({ rows: existingHoldings });
    if (sql.startsWith('DELETE FROM tx_holdings')) return Promise.resolve({});
    if (sql.startsWith('INSERT INTO tx_holdings')) return Promise.resolve({});
    if (sql.startsWith('INSERT INTO tx_cash_positions')) return Promise.resolve({});
    if (sql.startsWith('INSERT INTO tx_uploads')) return Promise.resolve({ rows: [{ id: uploadId }] });
    if (sql.startsWith('INSERT INTO tx_portfolio_action_hist')) return Promise.resolve({});
    return Promise.resolve({ rows: [] });
  });
  return { query, release: jest.fn() };
}

function holding(overrides: Partial<HoldingEntry> = {}): HoldingEntry {
  return {
    symbol: 'AAPL', name: 'Apple', quantity: 10, purchasePrice: 150, currentPrice: 150,
    sector: 'Tech', purchaseDate: '', costBasis: 1500, currentValue: 1500, gainLoss: 0, returnPct: 0,
    ...overrides,
  };
}

function parseResult(data: HoldingEntry[], cashAmount = 0): ParseResult {
  return { data, errors: [], cashAmount };
}

function actionHistCall(client: { query: jest.Mock }) {
  return client.query.mock.calls.find((c: unknown[]) => (c[0] as string).startsWith('INSERT INTO tx_portfolio_action_hist'));
}

function tickerInsertCall(client: { query: jest.Mock }) {
  return client.query.mock.calls.find((c: unknown[]) => (c[0] as string).startsWith('INSERT INTO m_tickers'));
}

describe('importHoldings', () => {
  test('throws PortfolioNotFoundError and rolls back when not owned', async () => {
    const client = makeMockClient({ ownerFound: false });
    mockConnect.mockResolvedValue(client);
    await expect(importHoldings('user-1', 'portfolio-1', parseResult([]), 'f.csv', 'csv')).rejects.toBeInstanceOf(PortfolioNotFoundError);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  test('a brand-new symbol produces a BUY action row at the imported price', async () => {
    const client = makeMockClient({ existingHoldings: [] });
    mockConnect.mockResolvedValue(client);
    const result = await importHoldings('user-1', 'portfolio-1', parseResult([holding({ symbol: 'AAPL', quantity: 10, currentPrice: 150 })]), 'f.csv', 'csv');
    expect(result.actionsLogged).toBe(1);
    expect(actionHistCall(client)?.[1]).toEqual(['portfolio-1', 'AAPL', 'BUY', 10, 150]);
  });

  test('a symbol dropped entirely produces a SELL action row using its last known price', async () => {
    const client = makeMockClient({ existingHoldings: [{ symbol: 'MSFT', quantity: '5', current_price: '300' }] });
    mockConnect.mockResolvedValue(client);
    const result = await importHoldings('user-1', 'portfolio-1', parseResult([]), 'f.csv', 'csv');
    expect(result.actionsLogged).toBe(1);
    expect(actionHistCall(client)?.[1]).toEqual(['portfolio-1', 'MSFT', 'SELL', 5, 300]);
  });

  test('a partial quantity increase produces a BUY with just the delta, at the new price', async () => {
    const client = makeMockClient({ existingHoldings: [{ symbol: 'AAPL', quantity: '10', current_price: '140' }] });
    mockConnect.mockResolvedValue(client);
    const result = await importHoldings('user-1', 'portfolio-1', parseResult([holding({ symbol: 'AAPL', quantity: 15, currentPrice: 150 })]), 'f.csv', 'csv');
    expect(result.actionsLogged).toBe(1);
    expect(actionHistCall(client)?.[1]).toEqual(['portfolio-1', 'AAPL', 'BUY', 5, 150]);
  });

  test('a partial quantity decrease produces a SELL with just the delta', async () => {
    const client = makeMockClient({ existingHoldings: [{ symbol: 'AAPL', quantity: '10', current_price: '140' }] });
    mockConnect.mockResolvedValue(client);
    const result = await importHoldings('user-1', 'portfolio-1', parseResult([holding({ symbol: 'AAPL', quantity: 4, currentPrice: 150 })]), 'f.csv', 'csv');
    expect(result.actionsLogged).toBe(1);
    expect(actionHistCall(client)?.[1]).toEqual(['portfolio-1', 'AAPL', 'SELL', 6, 150]);
  });

  test('an unchanged quantity produces no action row', async () => {
    const client = makeMockClient({ existingHoldings: [{ symbol: 'AAPL', quantity: '10', current_price: '140' }] });
    mockConnect.mockResolvedValue(client);
    const result = await importHoldings('user-1', 'portfolio-1', parseResult([holding({ symbol: 'AAPL', quantity: 10, currentPrice: 150 })]), 'f.csv', 'csv');
    expect(result.actionsLogged).toBe(0);
  });

  test('inserts a bare m_tickers row (symbol + resolved sector) for each imported symbol, ON CONFLICT DO NOTHING so an already-enriched row is never overwritten', async () => {
    const client = makeMockClient({ existingHoldings: [] });
    mockConnect.mockResolvedValue(client);
    await importHoldings(
      'user-1', 'portfolio-1',
      parseResult([holding({ symbol: 'AAPL', sector: 'Technology' }), holding({ symbol: 'ZZZ', sector: 'Unknown' })]),
      'f.csv', 'csv',
    );
    const call = tickerInsertCall(client);
    expect(call?.[0]).toContain('ON CONFLICT (symbol) DO NOTHING');
    expect(call?.[1]).toEqual(['AAPL', 'Technology', 'ZZZ', 'Unknown']);
  });

  test('a duplicate symbol in one import only produces one m_tickers row (deduped, not one insert per holding row)', async () => {
    const client = makeMockClient({ existingHoldings: [] });
    mockConnect.mockResolvedValue(client);
    await importHoldings(
      'user-1', 'portfolio-1',
      parseResult([holding({ symbol: 'AAPL' }), holding({ symbol: 'AAPL' })]),
      'f.csv', 'csv',
    );
    expect(tickerInsertCall(client)?.[1]).toEqual(['AAPL', 'Tech']);
  });

  test('no m_tickers insert at all when the import has zero holdings (e.g. a fully-cash portfolio)', async () => {
    const client = makeMockClient({ existingHoldings: [] });
    mockConnect.mockResolvedValue(client);
    await importHoldings('user-1', 'portfolio-1', parseResult([]), 'f.csv', 'csv');
    expect(tickerInsertCall(client)).toBeUndefined();
  });

  test('rolls back and rethrows on a mid-transaction failure', async () => {
    const client = makeMockClient();
    client.query
      .mockImplementationOnce(() => Promise.resolve({})) // BEGIN
      .mockImplementationOnce(() => { throw new Error('db exploded'); }); // ownership check
    mockConnect.mockResolvedValue(client);
    await expect(importHoldings('user-1', 'portfolio-1', parseResult([]), 'f.csv', 'csv')).rejects.toThrow('db exploded');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

// --- refreshPrices ---

describe('refreshPrices', () => {
  test('throws PortfolioNotFoundError when not owned', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(refreshPrices('user-1', 'nope')).rejects.toBeInstanceOf(PortfolioNotFoundError);
  });

  test('persists price_updated_at only for holdings that got a quote, leaves the rest untouched', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: '1' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'h1', symbol: 'AAPL', name: 'Apple', quantity: '10', purchase_price: '100', current_price: '100',
            sector: 'Tech', purchase_date: null, cost_basis: '1000', current_value: '1000', gain_loss: '0',
            return_pct: '0', allocation_pct: '50', price_updated_at: null,
          },
          {
            id: 'h2', symbol: 'MSFT', name: 'Microsoft', quantity: '5', purchase_price: '200', current_price: '200',
            sector: 'Tech', purchase_date: null, cost_basis: '1000', current_value: '1000', gain_loss: '0',
            return_pct: '0', allocation_pct: '50', price_updated_at: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ price_updated_at: '2026-07-12T00:00:00Z' }] }); // UPDATE for AAPL only

    mockGetQuotes.mockResolvedValue({ AAPL: { price: 150, changeDollar: 50, changePercent: 50, name: 'Apple' } }); // MSFT absent

    const result = await refreshPrices('user-1', '1');
    const aapl = result.holdings.find((r) => r.symbol === 'AAPL');
    const msft = result.holdings.find((r) => r.symbol === 'MSFT');

    expect(aapl?.currentPrice).toBe(150);
    expect(aapl?.priceUpdatedAt).toBe('2026-07-12T00:00:00Z');
    expect(aapl?.todayChangeDollar).toBe(500); // quantity (10) * per-share change (50), not the raw per-share change
    expect(aapl?.todayChangePercent).toBe(50);
    expect(msft?.currentPrice).toBe(200); // unchanged, stale
    expect(msft?.priceUpdatedAt).toBeNull(); // left untouched
    expect(msft?.todayChangeDollar).toBeNull(); // no quote match this refresh
  });

  test('a holding with no fresh quote this refresh keeps its previously-persisted today_change_dollar/percent, same honesty principle as price_updated_at', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'h1', symbol: 'MSFT', name: 'Microsoft', quantity: '5', purchase_price: '200', current_price: '200',
          sector: 'Tech', purchase_date: null, cost_basis: '1000', current_value: '1000', gain_loss: '0',
          return_pct: '0', allocation_pct: '50', price_updated_at: '2026-07-10T00:00:00Z',
          today_change_dollar: '25', today_change_percent: '1.5',
        }],
      });
    mockGetQuotes.mockResolvedValue({}); // MSFT absent this refresh

    const result = await refreshPrices('user-1', '1');
    const msft = result.holdings.find((r) => r.symbol === 'MSFT');
    expect(msft?.todayChangeDollar).toBe(25); // stale but real - not blanked to null
    expect(msft?.todayChangePercent).toBe(1.5);
  });

  test('todayChangeDollar is the POSITION dollar change (quantity * per-share change), not the raw per-share change', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'h1', symbol: 'AAPL', name: 'Apple', quantity: '2.5', purchase_price: '100', current_price: '100',
          sector: 'Tech', purchase_date: null, cost_basis: '250', current_value: '250', gain_loss: '0',
          return_pct: '0', allocation_pct: '100', price_updated_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ price_updated_at: '2026-07-12T00:00:00Z' }] });
    mockGetQuotes.mockResolvedValue({ AAPL: { price: 150, changeDollar: 4, changePercent: 2.7, name: 'Apple' } });

    const result = await refreshPrices('user-1', '1');
    const aapl = result.holdings.find((r) => r.symbol === 'AAPL');
    expect(aapl?.todayChangeDollar).toBe(10); // 2.5 shares * $4/share, not $4
    expect(aapl?.todayChangePercent).toBe(2.7); // percent is a ratio - unaffected by quantity
  });

  test('returns empty holdings/performanceHistory when the portfolio has no holdings (skips key resolution entirely)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1' }] }).mockResolvedValueOnce({ rows: [] });
    const result = await refreshPrices('user-1', '1');
    expect(result).toEqual({ holdings: [], performanceHistory: {} });
    expect(mockGetDecryptedKey).not.toHaveBeenCalled();
    expect(mockGetQuotes).not.toHaveBeenCalled();
  });

  test('fetches ~130-day history in parallel for each held symbol, keyed by symbol, excluding crypto', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: '1' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'h1', symbol: 'AAPL', name: 'Apple', quantity: '10', purchase_price: '100', current_price: '100',
            sector: 'Tech', purchase_date: null, cost_basis: '1000', current_value: '1000', gain_loss: '0',
            return_pct: '0', allocation_pct: '50', price_updated_at: null,
          },
          {
            id: 'h2', symbol: 'BTC', name: 'Bitcoin', quantity: '1', purchase_price: '30000', current_price: '30000',
            sector: 'Crypto', purchase_date: null, cost_basis: '30000', current_value: '30000', gain_loss: '0',
            return_pct: '0', allocation_pct: '50', price_updated_at: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ price_updated_at: '2026-07-12T00:00:00Z' }] });

    mockGetQuotes.mockResolvedValue({ AAPL: { price: 150, changeDollar: 5, changePercent: 3 } });
    mockGetHistorical.mockResolvedValue([{ date: '2026-07-01', close: 145, low: 140 }]);

    const result = await refreshPrices('user-1', '1');

    expect(mockGetHistorical).toHaveBeenCalledTimes(1); // only AAPL, not the crypto holding
    expect(mockGetHistorical).toHaveBeenCalledWith('AAPL', 'fake-fmp-key', 130);
    expect(result.performanceHistory).toEqual({ AAPL: [{ date: '2026-07-01', close: 145, low: 140 }] });
    expect(result.performanceHistory.BTC).toBeUndefined();
  });

  test('maps a bare crypto symbol to FMP\'s pair format for the quote fetch, then applies the result back under the original bare symbol', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'h1', symbol: 'BTC', name: 'Bitcoin', quantity: '0.02', purchase_price: '60000', current_price: '60000',
          sector: 'Crypto', purchase_date: null, cost_basis: '1200', current_value: '1200', gain_loss: '0',
          return_pct: '0', allocation_pct: '100', price_updated_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ price_updated_at: '2026-07-12T00:00:00Z' }] });

    mockGetQuotes.mockResolvedValue({ BTCUSD: { price: 71393, changeDollar: 1000, changePercent: 1.4, name: 'Bitcoin' } });

    const result = await refreshPrices('user-1', '1');

    expect(mockGetQuotes).toHaveBeenCalledWith(['BTCUSD'], 'fake-fmp-key');
    const btc = result.holdings.find((r) => r.symbol === 'BTC');
    expect(btc?.currentPrice).toBe(71393); // live price applied under the bare symbol, not left stale
    expect(btc?.priceUpdatedAt).toBe('2026-07-12T00:00:00Z');
  });

  test('a symbol already in FMP pair format (e.g. imported as BTCUSD) is queried as-is, not double-suffixed', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'h1', symbol: 'BTCUSD', name: 'Bitcoin', quantity: '0.02', purchase_price: '60000', current_price: '60000',
          sector: 'Crypto', purchase_date: null, cost_basis: '1200', current_value: '1200', gain_loss: '0',
          return_pct: '0', allocation_pct: '100', price_updated_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ price_updated_at: '2026-07-12T00:00:00Z' }] });

    mockGetQuotes.mockResolvedValue({ BTCUSD: { price: 71393, changeDollar: 1000, changePercent: 1.4, name: 'Bitcoin' } });

    await refreshPrices('user-1', '1');
    expect(mockGetQuotes).toHaveBeenCalledWith(['BTCUSD'], 'fake-fmp-key'); // not BTCUSDUSD
  });

  test('propagates MissingUserApiKeyError when the user has no FMP key on file', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'h1', symbol: 'AAPL', name: 'Apple', quantity: '10', purchase_price: '100', current_price: '100',
          sector: 'Tech', purchase_date: null, cost_basis: '1000', current_value: '1000', gain_loss: '0',
          return_pct: '0', allocation_pct: '100', price_updated_at: null,
        }],
      });
    mockGetDecryptedKey.mockRejectedValue(new userSubscription.MissingUserApiKeyError('No fmp API key on file.'));
    await expect(refreshPrices('user-1', '1')).rejects.toBeInstanceOf(userSubscription.MissingUserApiKeyError);
    expect(mockGetQuotes).not.toHaveBeenCalled();
  });
});
