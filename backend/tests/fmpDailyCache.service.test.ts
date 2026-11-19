jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));

import { pool } from '../src/db/pool';
import { getEasternDateString, isMarketOpenNow, getOrFetch } from '../src/services/fmpDailyCache.service';

const mockQuery = pool.query as unknown as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
});

describe('getEasternDateString', () => {
  test('formats as YYYY-MM-DD', () => {
    const d = new Date('2026-09-07T15:00:00Z'); // 11am Eastern (EDT, UTC-4)
    expect(getEasternDateString(d)).toBe('2026-09-07');
  });

  test('a date just after UTC midnight that is still the prior Eastern evening rolls back a day', () => {
    const d = new Date('2026-09-07T02:00:00Z'); // 10pm Eastern the day before
    expect(getEasternDateString(d)).toBe('2026-09-06');
  });
});

describe('isMarketOpenNow', () => {
  test('true on a weekday during regular market hours', () => {
    // 2026-09-08 is a Tuesday. 14:00 UTC = 10:00 Eastern (EDT).
    expect(isMarketOpenNow(new Date('2026-09-08T14:00:00Z'))).toBe(true);
  });

  test('false on a weekday before market open', () => {
    // 12:00 UTC = 08:00 Eastern - before 9:30.
    expect(isMarketOpenNow(new Date('2026-09-08T12:00:00Z'))).toBe(false);
  });

  test('false on a weekday after market close', () => {
    // 21:00 UTC = 17:00 Eastern - after 16:00.
    expect(isMarketOpenNow(new Date('2026-09-08T21:00:00Z'))).toBe(false);
  });

  test('false on a Saturday, even during what would be market hours on a weekday', () => {
    // 2026-09-12 is a Saturday.
    expect(isMarketOpenNow(new Date('2026-09-12T14:00:00Z'))).toBe(false);
  });

  test('true on a weekday market holiday (e.g. Labor Day) - no holiday calendar, by design', () => {
    // 2026-09-07 is Labor Day, a Monday - deliberately not special-cased.
    expect(isMarketOpenNow(new Date('2026-09-07T14:00:00Z'))).toBe(true);
  });
});

describe('getOrFetch', () => {
  test('no existing row - calls fetchFn and inserts a new row', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // SELECT - no row
      .mockResolvedValueOnce({ rows: [] }); // INSERT/UPSERT
    const fetchFn = jest.fn().mockResolvedValue({ price: 150 });

    const result = await getOrFetch('AAPL', 'quote', 'GET /quote?symbol=AAPL', fetchFn);

    expect(result).toEqual({ data: { price: 150 }, wasCached: false });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[1][0]).toContain('INSERT INTO m_fmp_daily_cache');
    expect(mockQuery.mock.calls[1][0]).toContain('ON CONFLICT');
    expect(mockQuery.mock.calls[1][1]).toEqual(['AAPL', 'quote', 'GET /quote?symbol=AAPL', getEasternDateString(), JSON.stringify({ price: 150 })]);
  });

  test('a same-day row - returns the cached value without calling fetchFn', async () => {
    const today = getEasternDateString();
    mockQuery.mockResolvedValueOnce({ rows: [{ api_result: { price: 150 }, cache_date: today }] });
    const fetchFn = jest.fn();

    const result = await getOrFetch('AAPL', 'quote', 'GET /quote?symbol=AAPL', fetchFn);

    expect(result).toEqual({ data: { price: 150 }, wasCached: true });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(1); // SELECT only, no write
  });

  test('a prior-day row is treated as a miss and gets overwritten', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ api_result: { price: 100 }, cache_date: '2020-01-01' }] })
      .mockResolvedValueOnce({ rows: [] });
    const fetchFn = jest.fn().mockResolvedValue({ price: 175 });

    const result = await getOrFetch('AAPL', 'quote', 'GET /quote?symbol=AAPL', fetchFn);

    expect(result).toEqual({ data: { price: 175 }, wasCached: false });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test('forceFresh always calls fetchFn even with a fresh same-day row present, and still writes through', async () => {
    const today = getEasternDateString();
    // No SELECT should even run when forceFresh is set - only the write.
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const fetchFn = jest.fn().mockResolvedValue({ price: 199 });

    const result = await getOrFetch('AAPL', 'quote', 'GET /quote?symbol=AAPL', fetchFn, { forceFresh: true });

    expect(result).toEqual({ data: { price: 199 }, wasCached: false });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(1); // write only, no read
    expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO m_fmp_daily_cache');
    expect(mockQuery.mock.calls[0][1][3]).toBe(today);
  });

  test('two concurrent calls for the same symbol+api coalesce into a single fetchFn call', async () => {
    // Both calls' SELECT resolves only after both have already started (simulating requests
    // arriving before either has written a row) - a manually-controlled promise stands in for
    // the mocked SELECT so neither call can race ahead of the other.
    let resolveSelect!: (v: { rows: unknown[] }) => void;
    mockQuery
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSelect = resolve; }))
      .mockResolvedValueOnce({ rows: [] }); // INSERT/UPSERT
    const fetchFn = jest.fn().mockResolvedValue({ price: 150 });

    const call1 = getOrFetch('AAPL', 'quote', 'GET /quote?symbol=AAPL', fetchFn);
    const call2 = getOrFetch('AAPL', 'quote', 'GET /quote?symbol=AAPL', fetchFn);
    resolveSelect({ rows: [] });

    const [result1, result2] = await Promise.all([call1, call2]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result1).toEqual({ data: { price: 150 }, wasCached: false });
    expect(result2).toEqual(result1);
    // Only one SELECT + one INSERT - the second caller never issued its own query at all.
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test('a later call for the same key after the first has settled starts a fresh fetch', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const fetchFn = jest.fn().mockResolvedValue({ price: 150 });

    await getOrFetch('AAPL', 'quote', 'GET /quote?symbol=AAPL', fetchFn);
    await getOrFetch('AAPL', 'quote', 'GET /quote?symbol=AAPL', fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  // requireFreshAfterOpen (2026-11-07): a same-day row isn't trustworthy for 'quote' lookups if
  // it was fetched before today's market open - at that moment it still necessarily reflects
  // the PRIOR session's close, yet gets tagged with today's cache_date all the same. Confirmed
  // live: a quote fetched at 1:44am Friday was still Thursday's 4pm close, and silently blocked
  // every real fetch for the rest of Friday since nobody happened to refresh during Friday's own
  // 9:30-4:00 window.
  describe('requireFreshAfterOpen', () => {
    afterEach(() => jest.useRealTimers());

    test('a same-day row written BEFORE today\'s open is treated as a miss once today\'s open has passed', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-06T22:00:00Z')); // Fri 5pm ET - well after today's open
      const today = getEasternDateString();
      mockQuery
        .mockResolvedValueOnce({ rows: [{ api_result: { price: 100 }, cache_date: today, updated_at: '2026-11-06T06:44:00.000Z' }] }) // Fri 1:44am ET
        .mockResolvedValueOnce({ rows: [] });
      const fetchFn = jest.fn().mockResolvedValue({ price: 175 });

      const result = await getOrFetch('AAPL', 'quote', 'GET /quote?symbol=AAPL', fetchFn, { requireFreshAfterOpen: true });

      expect(result).toEqual({ data: { price: 175 }, wasCached: false });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    test('a same-day row written AFTER today\'s open is still a genuine cache hit', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-06T22:00:00Z')); // Fri 5pm ET
      const today = getEasternDateString();
      mockQuery.mockResolvedValueOnce({ rows: [{ api_result: { price: 100 }, cache_date: today, updated_at: '2026-11-06T15:00:00.000Z' }] }); // Fri 10am ET
      const fetchFn = jest.fn();

      const result = await getOrFetch('AAPL', 'quote', 'GET /quote?symbol=AAPL', fetchFn, { requireFreshAfterOpen: true });

      expect(result).toEqual({ data: { price: 100 }, wasCached: true });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    test('a pre-market row is still accepted as-is before today\'s own open has arrived - nothing fresher could exist yet', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-06T07:00:00Z')); // Fri 2am ET - before today's open
      const today = getEasternDateString();
      mockQuery.mockResolvedValueOnce({ rows: [{ api_result: { price: 100 }, cache_date: today, updated_at: '2026-11-06T06:44:00.000Z' }] });
      const fetchFn = jest.fn();

      const result = await getOrFetch('AAPL', 'quote', 'GET /quote?symbol=AAPL', fetchFn, { requireFreshAfterOpen: true });

      expect(result).toEqual({ data: { price: 100 }, wasCached: true });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    test('ignored entirely when requireFreshAfterOpen is not set - a pre-market row is accepted as a normal cache hit', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-06T22:00:00Z')); // Fri 5pm ET
      const today = getEasternDateString();
      mockQuery.mockResolvedValueOnce({ rows: [{ api_result: { price: 100 }, cache_date: today, updated_at: '2026-11-06T06:44:00.000Z' }] });
      const fetchFn = jest.fn();

      const result = await getOrFetch('AAPL', 'profile', 'GET /profile?symbol=AAPL', fetchFn);

      expect(result).toEqual({ data: { price: 100 }, wasCached: true });
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });
});
