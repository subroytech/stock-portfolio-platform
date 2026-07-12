jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/marketData.service');

import { pool } from '../src/db/pool';
import * as marketData from '../src/services/marketData.service';
import {
  listPortfolios, createPortfolio, getPortfolio, updatePortfolio, deletePortfolio,
  importHoldings, refreshPrices, PortfolioNotFoundError, PortfolioNameConflictError,
} from '../src/services/portfolio.service';
import { ParseResult, HoldingEntry } from '../src/services/parser.service';

const mockQuery = pool.query as unknown as jest.Mock;
const mockConnect = pool.connect as unknown as jest.Mock;
const mockGetQuotes = marketData.getQuotes as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
  mockGetQuotes.mockReset();
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
    const aapl = result.find((r) => r.symbol === 'AAPL');
    const msft = result.find((r) => r.symbol === 'MSFT');

    expect(aapl?.currentPrice).toBe(150);
    expect(aapl?.priceUpdatedAt).toBe('2026-07-12T00:00:00Z');
    expect(msft?.currentPrice).toBe(200); // unchanged, stale
    expect(msft?.priceUpdatedAt).toBeNull(); // left untouched
  });

  test('returns an empty array when the portfolio has no holdings', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1' }] }).mockResolvedValueOnce({ rows: [] });
    const result = await refreshPrices('user-1', '1');
    expect(result).toEqual([]);
    expect(mockGetQuotes).not.toHaveBeenCalled();
  });
});
