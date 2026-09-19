jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
// Partial mock, not a full jest.mock(...) automock: AnalysisServiceError is a
// real Error subclass exported alongside checkHealth, and the controller's
// catch block relies on `instanceof AnalysisServiceError` — automocking the
// whole module would replace that class with a mock constructor and break
// the instanceof check (same pattern as userSubscription.service's tests).
jest.mock('../src/services/analysisService', () => ({
  ...jest.requireActual('../src/services/analysisService'),
  checkHealth: jest.fn(),
  computeLongTermAnalysis: jest.fn(),
  computeContrarianComebackGate: jest.fn(),
  computeContrarianComebackSubmit: jest.fn(),
}));
jest.mock('../src/services/longTermAnalysisData.service');
jest.mock('../src/services/contrarianComebackData.service');
jest.mock('../src/services/userSubscription.service', () => ({
  ...jest.requireActual('../src/services/userSubscription.service'),
  getDecryptedKey: jest.fn(),
}));
jest.mock('../src/services/usageTracking.service');
// The 2 new Gate<->Submit cache tests below push this file's total real request count against
// these routes past the real rateLimiters' per-user window (found live: a Gate request was
// silently 429'd mid-suite, which looked like a cache/expiry bug until traced to this) - same
// pass-through mock precedent as flexQuota.controller.test.ts.
jest.mock('../src/middleware/rateLimit', () => ({
  __esModule: true,
  default: [(_req: unknown, _res: unknown, next: () => void) => next(), (_req: unknown, _res: unknown, next: () => void) => next()],
}));

import request from 'supertest';
import * as analysisService from '../src/services/analysisService';
import * as longTermAnalysisData from '../src/services/longTermAnalysisData.service';
import * as contrarianComebackData from '../src/services/contrarianComebackData.service';
import * as contrarianComebackCache from '../src/services/contrarianComebackCache';
import * as userSubscription from '../src/services/userSubscription.service';
import * as usageTracking from '../src/services/usageTracking.service';
import { InvalidTickerError } from '../src/utils/errors';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockCheckHealth = analysisService.checkHealth as jest.Mock;
const mockComputeLongTermAnalysis = analysisService.computeLongTermAnalysis as jest.Mock;
const mockFetchLongTermAnalysisData = longTermAnalysisData.fetchLongTermAnalysisData as jest.Mock;
const mockComputeContrarianComebackGate = analysisService.computeContrarianComebackGate as jest.Mock;
const mockComputeContrarianComebackSubmit = analysisService.computeContrarianComebackSubmit as jest.Mock;
const mockFetchContrarianComebackData = contrarianComebackData.fetchContrarianComebackData as jest.Mock;
const mockGetDecryptedKey = userSubscription.getDecryptedKey as jest.Mock;
const mockLogUsage = usageTracking.logUsage as jest.Mock;

const authCookie = `auth_token=${signToken('user-1')}`;

beforeEach(() => {
  mockCheckHealth.mockReset();
  mockComputeLongTermAnalysis.mockReset();
  mockFetchLongTermAnalysisData.mockReset();
  mockComputeContrarianComebackGate.mockReset();
  mockComputeContrarianComebackSubmit.mockReset();
  mockFetchContrarianComebackData.mockReset();
  mockGetDecryptedKey.mockReset();
  mockGetDecryptedKey.mockImplementation((_userId: string, provider: string) =>
    provider === 'fmp' ? Promise.resolve('fake-fmp-key') : Promise.reject(new userSubscription.MissingUserApiKeyError('No finnhub API key on file.')),
  );
  mockLogUsage.mockReset();
  mockLogUsage.mockResolvedValue(undefined);
  // contrarianComebackCache is the real module (not mocked) - several tests below reuse
  // 'user-1'/'AAPL', so without this an earlier test's Gate call would leak a cache hit into a
  // later, unrelated Submit test.
  contrarianComebackCache.clearAll();
});

describe('GET /analysis/health', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/analysis/health');
    expect(res.status).toBe(401);
  });

  test('200 proxies the Python service response', async () => {
    mockCheckHealth.mockResolvedValue({ status: 'ok' });
    const res = await request(app).get('/analysis/health').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('503 when the Python service is unreachable', async () => {
    mockCheckHealth.mockRejectedValue(new analysisService.AnalysisServiceError('Analysis service unavailable.'));
    const res = await request(app).get('/analysis/health').set('Cookie', authCookie);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Analysis service unavailable.' });
  });
});

describe('GET /analysis/long-term/:symbol', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/analysis/long-term/AAPL');
    expect(res.status).toBe(401);
  });

  test('400 for a blank symbol', async () => {
    const res = await request(app).get('/analysis/long-term/%20').set('Cookie', authCookie);
    expect(res.status).toBe(400);
  });

  test('503 when the caller has no FMP key on file', async () => {
    mockGetDecryptedKey.mockImplementation(() => Promise.reject(new userSubscription.MissingUserApiKeyError('No fmp API key on file.')));
    const res = await request(app).get('/analysis/long-term/AAPL').set('Cookie', authCookie);
    expect(res.status).toBe(503);
    expect(mockFetchLongTermAnalysisData).not.toHaveBeenCalled();
  });

  test('200 with an empty news list when the caller has no Finnhub key — Finnhub stays optional', async () => {
    mockFetchLongTermAnalysisData.mockResolvedValue({ symbol: 'AAPL' });
    mockComputeLongTermAnalysis.mockResolvedValue({ symbol: 'AAPL', news: [] });
    const res = await request(app).get('/analysis/long-term/AAPL').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(mockFetchLongTermAnalysisData).toHaveBeenCalledWith('AAPL', 'fake-fmp-key', undefined);
  });

  test('503 when the Python service errors', async () => {
    mockFetchLongTermAnalysisData.mockResolvedValue({ symbol: 'AAPL' });
    mockComputeLongTermAnalysis.mockRejectedValue(new analysisService.AnalysisServiceError('Analysis service unavailable.'));
    const res = await request(app).get('/analysis/long-term/AAPL').set('Cookie', authCookie);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Analysis service unavailable.' });
  });

  test('200 happy path with a Finnhub key on file too', async () => {
    mockGetDecryptedKey.mockImplementation((_userId: string, provider: string) =>
      Promise.resolve(provider === 'fmp' ? 'fake-fmp-key' : 'fake-finnhub-key'),
    );
    mockFetchLongTermAnalysisData.mockResolvedValue({ symbol: 'AAPL' });
    mockComputeLongTermAnalysis.mockResolvedValue({ symbol: 'AAPL', mediumTerm: { rating: 'bullish' } });
    const res = await request(app).get('/analysis/long-term/AAPL').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ symbol: 'AAPL', mediumTerm: { rating: 'bullish' } });
    expect(mockFetchLongTermAnalysisData).toHaveBeenCalledWith('AAPL', 'fake-fmp-key', 'fake-finnhub-key');
  });

  test('symbol is uppercased regardless of request casing', async () => {
    mockFetchLongTermAnalysisData.mockResolvedValue({ symbol: 'AAPL' });
    mockComputeLongTermAnalysis.mockResolvedValue({ symbol: 'AAPL' });
    const res = await request(app).get('/analysis/long-term/aapl').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(mockFetchLongTermAnalysisData).toHaveBeenCalledWith('AAPL', 'fake-fmp-key', undefined);
  });

  test('404 when the ticker does not exist', async () => {
    mockFetchLongTermAnalysisData.mockRejectedValue(new InvalidTickerError('No data returned for ZZZZ. Check the ticker symbol or your API key.'));
    const res = await request(app).get('/analysis/long-term/ZZZZ').set('Cookie', authCookie);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'No data returned for ZZZZ. Check the ticker symbol or your API key.' });
  });

  test('logs usage on a successful analysis, with real per-provider API call counts', async () => {
    mockFetchLongTermAnalysisData.mockResolvedValue({ symbol: 'AAPL', apiCallCounts: { fmp: 15, finnhub: 1 } });
    mockComputeLongTermAnalysis.mockResolvedValue({ symbol: 'AAPL' });
    const res = await request(app).get('/analysis/long-term/AAPL').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(mockLogUsage).toHaveBeenCalledWith('user-1', 'long_term_analysis', { fmp: 15, finnhub: 1 });
  });

  test('a failed usage log does not turn a successful response into a 500 (fire-and-forget)', async () => {
    mockFetchLongTermAnalysisData.mockResolvedValue({ symbol: 'AAPL' });
    mockComputeLongTermAnalysis.mockResolvedValue({ symbol: 'AAPL' });
    mockLogUsage.mockRejectedValue(new Error('usage log db exploded'));
    const res = await request(app).get('/analysis/long-term/AAPL').set('Cookie', authCookie);
    expect(res.status).toBe(200);
  });
});

describe('GET /analysis/contrarian-comeback/:symbol/gate', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/analysis/contrarian-comeback/AAPL/gate');
    expect(res.status).toBe(401);
  });

  test('400 for a blank symbol', async () => {
    const res = await request(app).get('/analysis/contrarian-comeback/%20/gate').set('Cookie', authCookie);
    expect(res.status).toBe(400);
  });

  test('503 when the caller has no FMP key on file', async () => {
    mockGetDecryptedKey.mockImplementation(() => Promise.reject(new userSubscription.MissingUserApiKeyError('No fmp API key on file.')));
    const res = await request(app).get('/analysis/contrarian-comeback/AAPL/gate').set('Cookie', authCookie);
    expect(res.status).toBe(503);
    expect(mockFetchContrarianComebackData).not.toHaveBeenCalled();
  });

  test('200 happy path, symbol uppercased regardless of request casing', async () => {
    mockFetchContrarianComebackData.mockResolvedValue({ symbol: 'AAPL', apiCallCounts: { fmp: 9, finnhub: 1 } });
    mockComputeContrarianComebackGate.mockResolvedValue({ symbol: 'AAPL', check1Pass: true, failedCheck: null });
    const res = await request(app).get('/analysis/contrarian-comeback/aapl/gate').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ symbol: 'AAPL', check1Pass: true, failedCheck: null });
    expect(mockFetchContrarianComebackData).toHaveBeenCalledWith('AAPL', 'fake-fmp-key', undefined);
    // apiCallCounts is stripped before reaching the analysis-service call - same "don't leak
    // internal bookkeeping into the cross-service payload" precedent as Submit below.
    expect(mockComputeContrarianComebackGate).toHaveBeenCalledWith({ symbol: 'AAPL' });
  });

  test('logs usage on a successful gate check, with real per-provider API call counts', async () => {
    mockFetchContrarianComebackData.mockResolvedValue({ symbol: 'AAPL', apiCallCounts: { fmp: 9, finnhub: 1 } });
    mockComputeContrarianComebackGate.mockResolvedValue({ symbol: 'AAPL', check1Pass: true, failedCheck: null });
    const res = await request(app).get('/analysis/contrarian-comeback/AAPL/gate').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    // Gate runs the exact same full fetch as Submit - previously only Submit was logged, which
    // meant an attempt that failed the gate (or was never carried through to Submit) left its
    // real FMP/Finnhub cost with zero record. Same feature bucket as Submit, not a new one.
    expect(mockLogUsage).toHaveBeenCalledWith('user-1', 'contrarian_comeback', { fmp: 9, finnhub: 1 });
  });

  test('a failed usage log does not turn a successful gate response into a 500 (fire-and-forget)', async () => {
    mockFetchContrarianComebackData.mockResolvedValue({ symbol: 'AAPL' });
    mockComputeContrarianComebackGate.mockResolvedValue({ symbol: 'AAPL', check1Pass: true, failedCheck: null });
    mockLogUsage.mockRejectedValue(new Error('usage log db exploded'));
    const res = await request(app).get('/analysis/contrarian-comeback/AAPL/gate').set('Cookie', authCookie);
    expect(res.status).toBe(200);
  });

  test('503 when the Python service errors', async () => {
    mockFetchContrarianComebackData.mockResolvedValue({ symbol: 'AAPL' });
    mockComputeContrarianComebackGate.mockRejectedValue(new analysisService.AnalysisServiceError('Analysis service unavailable.'));
    const res = await request(app).get('/analysis/contrarian-comeback/AAPL/gate').set('Cookie', authCookie);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Analysis service unavailable.' });
  });

  test('404 when the ticker does not exist', async () => {
    mockFetchContrarianComebackData.mockRejectedValue(new InvalidTickerError('No data returned for ZZZZ. Check the ticker symbol or your API key.'));
    const res = await request(app).get('/analysis/contrarian-comeback/ZZZZ/gate').set('Cookie', authCookie);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'No data returned for ZZZZ. Check the ticker symbol or your API key.' });
  });
});

describe('POST /analysis/contrarian-comeback/:symbol', () => {
  const validBody = { breakdownTypes: ['event'], catalystAnswer: 'yes' };

  test('401 without a session cookie', async () => {
    const res = await request(app).post('/analysis/contrarian-comeback/AAPL').send(validBody);
    expect(res.status).toBe(401);
  });

  test('400 for a blank symbol', async () => {
    const res = await request(app).post('/analysis/contrarian-comeback/%20').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(400);
  });

  test('400 when breakdownTypes is empty', async () => {
    const res = await request(app).post('/analysis/contrarian-comeback/AAPL').set('Cookie', authCookie).send({ breakdownTypes: [], catalystAnswer: 'yes' });
    expect(res.status).toBe(400);
    expect(mockFetchContrarianComebackData).not.toHaveBeenCalled();
  });

  test('400 when catalystAnswer is missing or invalid', async () => {
    const res = await request(app).post('/analysis/contrarian-comeback/AAPL').set('Cookie', authCookie).send({ breakdownTypes: ['event'] });
    expect(res.status).toBe(400);
  });

  test('503 when the caller has no FMP key on file', async () => {
    mockGetDecryptedKey.mockImplementation(() => Promise.reject(new userSubscription.MissingUserApiKeyError('No fmp API key on file.')));
    const res = await request(app).post('/analysis/contrarian-comeback/AAPL').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(503);
    expect(mockFetchContrarianComebackData).not.toHaveBeenCalled();
  });

  test('200 happy path passes breakdownTypes/catalystAnswer/check3Override through to the analysis service', async () => {
    mockFetchContrarianComebackData.mockResolvedValue({ symbol: 'AAPL', price: 100 });
    mockComputeContrarianComebackSubmit.mockResolvedValue({ symbol: 'AAPL', format: 'A' });
    const res = await request(app).post('/analysis/contrarian-comeback/AAPL').set('Cookie', authCookie)
      .send({ breakdownTypes: ['cyclical'], catalystAnswer: 'yes', check3Override: true, check3OverrideReason: 'macro' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ symbol: 'AAPL', format: 'A' });
    expect(mockComputeContrarianComebackSubmit).toHaveBeenCalledWith({
      symbol: 'AAPL', price: 100,
      breakdownTypes: ['cyclical'], catalystAnswer: 'yes', check3Override: true, check3OverrideReason: 'macro',
    });
  });

  test('check3Override defaults to false and check3OverrideReason to null when omitted', async () => {
    mockFetchContrarianComebackData.mockResolvedValue({ symbol: 'AAPL' });
    mockComputeContrarianComebackSubmit.mockResolvedValue({ symbol: 'AAPL', format: 'B' });
    const res = await request(app).post('/analysis/contrarian-comeback/AAPL').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(200);
    expect(mockComputeContrarianComebackSubmit).toHaveBeenCalledWith(expect.objectContaining({ check3Override: false, check3OverrideReason: null }));
  });

  test('503 when the Python service errors', async () => {
    mockFetchContrarianComebackData.mockResolvedValue({ symbol: 'AAPL' });
    mockComputeContrarianComebackSubmit.mockRejectedValue(new analysisService.AnalysisServiceError('Analysis service unavailable.'));
    const res = await request(app).post('/analysis/contrarian-comeback/AAPL').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Analysis service unavailable.' });
  });

  test('404 when the ticker does not exist', async () => {
    mockFetchContrarianComebackData.mockRejectedValue(new InvalidTickerError('No data returned for ZZZZ. Check the ticker symbol or your API key.'));
    const res = await request(app).post('/analysis/contrarian-comeback/ZZZZ').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'No data returned for ZZZZ. Check the ticker symbol or your API key.' });
  });

  test('logs usage on a successful submit, with real per-provider API call counts', async () => {
    mockFetchContrarianComebackData.mockResolvedValue({ symbol: 'AAPL', apiCallCounts: { fmp: 10, finnhub: 1 } });
    mockComputeContrarianComebackSubmit.mockResolvedValue({ symbol: 'AAPL', format: 'A' });
    const res = await request(app).post('/analysis/contrarian-comeback/AAPL').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(200);
    expect(mockLogUsage).toHaveBeenCalledWith('user-1', 'contrarian_comeback', { fmp: 10, finnhub: 1 });
  });

  test('a failed usage log does not turn a successful response into a 500 (fire-and-forget)', async () => {
    mockFetchContrarianComebackData.mockResolvedValue({ symbol: 'AAPL' });
    mockComputeContrarianComebackSubmit.mockResolvedValue({ symbol: 'AAPL', format: 'A' });
    mockLogUsage.mockRejectedValue(new Error('usage log db exploded'));
    const res = await request(app).post('/analysis/contrarian-comeback/AAPL').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(200);
  });

  test('reuses a fresh Gate result within 30 minutes, skips the fetch and key lookup, and logs a zero-cost event', async () => {
    mockFetchContrarianComebackData.mockResolvedValue({ symbol: 'AAPL', price: 100, apiCallCounts: { fmp: 9, finnhub: 1 } });
    mockComputeContrarianComebackGate.mockResolvedValue({ symbol: 'AAPL', check1Pass: true, failedCheck: null });
    const gateRes = await request(app).get('/analysis/contrarian-comeback/AAPL/gate').set('Cookie', authCookie);
    expect(gateRes.status).toBe(200);

    const decryptedKeyCallsAfterGate = mockGetDecryptedKey.mock.calls.length;

    mockComputeContrarianComebackSubmit.mockResolvedValue({ symbol: 'AAPL', format: 'A' });
    const submitRes = await request(app).post('/analysis/contrarian-comeback/AAPL').set('Cookie', authCookie).send(validBody);
    expect(submitRes.status).toBe(200);

    expect(mockFetchContrarianComebackData).toHaveBeenCalledTimes(1); // only Gate's fetch - Submit reused it
    expect(mockGetDecryptedKey.mock.calls.length).toBe(decryptedKeyCallsAfterGate); // Submit never resolved keys
    expect(mockComputeContrarianComebackSubmit).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'AAPL', price: 100 }));
    expect(mockLogUsage).toHaveBeenNthCalledWith(1, 'user-1', 'contrarian_comeback', { fmp: 9, finnhub: 1 }); // Gate - real cost
    expect(mockLogUsage).toHaveBeenNthCalledWith(2, 'user-1', 'contrarian_comeback', { fmp: 0, finnhub: 0 }); // Submit - cache hit
  });

  test('an expired (30+ minute old) Gate result is not reused - Submit falls back to a fresh fetch', async () => {
    // Date.now() is mocked directly rather than via jest.useFakeTimers() - full fake timers
    // interferes with supertest's own request/response round trip. The cache module's own
    // expiry logic (contrarianComebackCache.test.ts) is already covered directly against real
    // time; this test's job is only to confirm the controller wiring falls back correctly once
    // getCachedGateResult reports a miss. Both mock values are anchored to one captured instant
    // (not two separate Date.now() reads) so the test can't be sensitive to how much real wall-
    // clock time elapses between the Gate and Submit requests.
    const anchor = Date.now();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(anchor);
    try {
      mockFetchContrarianComebackData.mockResolvedValue({ symbol: 'AAPL', apiCallCounts: { fmp: 9, finnhub: 1 } });
      mockComputeContrarianComebackGate.mockResolvedValue({ symbol: 'AAPL', check1Pass: true, failedCheck: null });
      await request(app).get('/analysis/contrarian-comeback/AAPL/gate').set('Cookie', authCookie);

      nowSpy.mockReturnValue(anchor + 30 * 60 * 1000 + 1);

      mockComputeContrarianComebackSubmit.mockResolvedValue({ symbol: 'AAPL', format: 'A' });
      const submitRes = await request(app).post('/analysis/contrarian-comeback/AAPL').set('Cookie', authCookie).send(validBody);

      expect(submitRes.status).toBe(200);
      expect(mockFetchContrarianComebackData).toHaveBeenCalledTimes(2); // Gate, then Submit's own fresh fetch
      expect(mockLogUsage).toHaveBeenNthCalledWith(2, 'user-1', 'contrarian_comeback', { fmp: 9, finnhub: 1 }); // real cost again, not zero
    } finally {
      nowSpy.mockRestore();
    }
  });
});
