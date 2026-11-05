import { getCachedGateResult, setCachedGateResult, clearAll } from '../src/services/contrarianComebackCache';
import type { ContrarianComebackData } from '../src/services/contrarianComebackData.service';

function fakeData(overrides: Partial<ContrarianComebackData> = {}): ContrarianComebackData {
  return {
    symbol: 'AAPL', companyName: 'Apple Inc.', sector: 'Technology', exchange: 'NASDAQ',
    price: 150, marketCap: 1000, yearHigh: 200, peRatio: 20,
    incomeStatements: [], dailyBars: [], etfSymbol: 'XLK', etfDailyBars: [],
    priceTarget: null, grades: [], insiderTrades: [], news: [],
    totalDebt: null, totalStockholdersEquity: null, totalCurrentAssets: null,
    totalCurrentLiabilities: null, cashAndCashEquivalents: null, operatingCashFlow: null,
    capitalExpenditure: null,
    ...overrides,
  };
}

describe('contrarianComebackCache', () => {
  beforeEach(() => {
    clearAll();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('returns null for a key that was never set', () => {
    expect(getCachedGateResult('user-1', 'AAPL')).toBeNull();
  });

  test('set then get round-trips the same data', () => {
    const data = fakeData();
    setCachedGateResult('user-1', 'AAPL', data);
    expect(getCachedGateResult('user-1', 'AAPL')).toEqual(data);
  });

  test('is scoped per (userId, symbol) - a different user or symbol misses', () => {
    setCachedGateResult('user-1', 'AAPL', fakeData());
    expect(getCachedGateResult('user-2', 'AAPL')).toBeNull();
    expect(getCachedGateResult('user-1', 'TSLA')).toBeNull();
  });

  test('a fresh entry (under 30 minutes old) is still returned', () => {
    setCachedGateResult('user-1', 'AAPL', fakeData());
    jest.advanceTimersByTime(29 * 60 * 1000);
    expect(getCachedGateResult('user-1', 'AAPL')).not.toBeNull();
  });

  test('an entry older than 30 minutes expires and returns null', () => {
    setCachedGateResult('user-1', 'AAPL', fakeData());
    jest.advanceTimersByTime(30 * 60 * 1000 + 1);
    expect(getCachedGateResult('user-1', 'AAPL')).toBeNull();
  });

  test('a later set for the same key overwrites and refreshes the expiry', () => {
    setCachedGateResult('user-1', 'AAPL', fakeData({ price: 100 }));
    jest.advanceTimersByTime(20 * 60 * 1000);
    setCachedGateResult('user-1', 'AAPL', fakeData({ price: 200 }));
    jest.advanceTimersByTime(20 * 60 * 1000); // 40 min after the first set, only 20 after the second
    expect(getCachedGateResult('user-1', 'AAPL')?.price).toBe(200);
  });

  test('clearAll empties the cache', () => {
    setCachedGateResult('user-1', 'AAPL', fakeData());
    clearAll();
    expect(getCachedGateResult('user-1', 'AAPL')).toBeNull();
  });
});
