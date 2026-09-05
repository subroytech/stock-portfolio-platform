jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/contrarianFinder.service', () => ({
  ...jest.requireActual('../src/services/contrarianFinder.service'),
  assembleUniverse: jest.fn(),
  assembleScanBatch: jest.fn(),
  getUniverseTable: jest.fn(),
  refreshTickerDataBatch: jest.fn(),
  saveLastScan: jest.fn(),
  getLastScan: jest.fn(),
  listRunHistory: jest.fn(),
  getRunById: jest.fn(),
}));
jest.mock('../src/services/userSubscription.service', () => ({
  ...jest.requireActual('../src/services/userSubscription.service'),
  getDecryptedKey: jest.fn(),
}));
jest.mock('../src/services/usageTracking.service');
// This file's test count grew with Run History's new endpoints - enough real
// requests against the real /contrarian-finder router (mounted with
// rateLimiters in app.ts) to trip the actual per-IP/per-user limiter
// mid-run. Same no-op mock already used by auth.controller.test.ts/
// portfolio.controller.test.ts for the same reason.
jest.mock('../src/middleware/rateLimit', () => ({
  __esModule: true,
  default: [(_req: unknown, _res: unknown, next: () => void) => next(), (_req: unknown, _res: unknown, next: () => void) => next()],
}));

import request from 'supertest';
import { pool } from '../src/db/pool';
import * as cf from '../src/services/contrarianFinder.service';
import * as analysisService from '../src/services/analysisService';
import * as userSubscription from '../src/services/userSubscription.service';
import * as usageTracking from '../src/services/usageTracking.service';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockAssembleUniverse = cf.assembleUniverse as jest.Mock;
const mockAssembleScanBatch = cf.assembleScanBatch as jest.Mock;
const mockGetUniverseTable = cf.getUniverseTable as jest.Mock;
const mockRefreshTickerDataBatch = cf.refreshTickerDataBatch as jest.Mock;
const mockSaveLastScan = cf.saveLastScan as jest.Mock;
const mockGetLastScan = cf.getLastScan as jest.Mock;
const mockListRunHistory = cf.listRunHistory as jest.Mock;
const mockGetRunById = cf.getRunById as jest.Mock;
const mockGetDecryptedKey = userSubscription.getDecryptedKey as jest.Mock;
const mockQuery = pool.query as unknown as jest.Mock;
const mockLogUsage = usageTracking.logUsage as jest.Mock;

const authCookie = `auth_token=${signToken('user-1')}`;

// 250 fake symbols - enough to build 2 full batches of 125 (matching the
// confirmed default batchSize) with nothing left over, exercising both
// "in range" and "out of range" batchIndex requests against a known plan.
const fakeUniverse = Array.from({ length: 250 }, (_, i) => ({ symbol: `S${i}`, tier: 1, source: 'TEST' }));

beforeEach(() => {
  mockAssembleUniverse.mockReset();
  mockAssembleScanBatch.mockReset();
  mockGetDecryptedKey.mockReset();
  mockGetDecryptedKey.mockResolvedValue('fake-fmp-key');
  mockAssembleUniverse.mockResolvedValue(fakeUniverse);
  mockAssembleScanBatch.mockImplementation((stocks: { symbol: string }[]) => Promise.resolve(
    stocks.map((s) => ({ symbol: s.symbol, filterFail: false, noData: false, changePct: -10 })),
  ));
  mockQuery.mockReset();
  // scan-batch is admin-only (requirePermission) - default every test here to
  // an "admin" caller (a matching role_permissions row) so the existing tests
  // below still exercise the controller itself, not the permission gate.
  mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
  mockLogUsage.mockReset();
  mockLogUsage.mockResolvedValue(undefined);
  mockGetUniverseTable.mockReset();
  mockRefreshTickerDataBatch.mockReset();
  mockRefreshTickerDataBatch.mockResolvedValue({ updated: 5, skipped: 1 });
  mockSaveLastScan.mockReset();
  mockSaveLastScan.mockResolvedValue(undefined);
  mockGetLastScan.mockReset();
  mockGetLastScan.mockResolvedValue(null);
  mockListRunHistory.mockReset();
  mockListRunHistory.mockResolvedValue([]);
  mockGetRunById.mockReset();
  mockGetRunById.mockResolvedValue(null);
});

describe('GET /contrarian-finder/universe', () => {
  const fakeUniverseTable = {
    indices: [{ id: 'DJ30', description: 'Dow Jones Industrial Average' }],
    stocks: [{ symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', indices: ['DJ30'] }],
  };

  test('401 without a session cookie', async () => {
    const res = await request(app).get('/contrarian-finder/universe');
    expect(res.status).toBe(401);
  });

  test('200 for a signed-in user with NO contrarian_finder:scan permission - genuinely ungated, unlike scan-batch', async () => {
    mockGetUniverseTable.mockResolvedValue(fakeUniverseTable);
    const res = await request(app).get('/contrarian-finder/universe').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeUniverseTable);
    // No requirePermission DB check ran at all for this route (unlike scan-batch's 403 test
    // below, which needs a `mockQuery.mockResolvedValueOnce({ rows: [] })` to prove the gate).
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('POST /contrarian-finder/scan-batch', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).post('/contrarian-finder/scan-batch').send({ batchIndex: 0 });
    expect(res.status).toBe(401);
  });

  test('403 for a signed-in user without the contrarian_finder:scan permission (not an admin)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/contrarian-finder/scan-batch').set('Cookie', authCookie).send({ batchIndex: 0 });
    expect(res.status).toBe(403);
    expect(mockAssembleUniverse).not.toHaveBeenCalled();
  });

  test('503 when the caller has no FMP key on file', async () => {
    mockGetDecryptedKey.mockRejectedValue(new userSubscription.MissingUserApiKeyError('No fmp API key on file.'));
    const res = await request(app).post('/contrarian-finder/scan-batch').set('Cookie', authCookie).send({ batchIndex: 0 });
    expect(res.status).toBe(503);
    expect(mockAssembleScanBatch).not.toHaveBeenCalled();
  });

  test('503 when the analysis-service is unavailable', async () => {
    mockAssembleScanBatch.mockRejectedValue(new analysisService.AnalysisServiceError('Analysis service unavailable.'));
    const res = await request(app).post('/contrarian-finder/scan-batch').set('Cookie', authCookie).send({ batchIndex: 0 });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Analysis service unavailable.');
  });

  test('200 scans exactly the requested batch, reports totalBatches and universeSize', async () => {
    const res = await request(app).post('/contrarian-finder/scan-batch').set('Cookie', authCookie)
      .send({ batchIndex: 0, batchSize: 125, maxBatches: 3 });
    expect(res.status).toBe(200);
    expect(res.body.batchIndex).toBe(0);
    expect(res.body.totalBatches).toBe(2); // 250 symbols / 125 per batch = exactly 2, not the requested 3
    expect(res.body.universeSize).toBe(250);
    expect(res.body.results).toHaveLength(125);
    expect(mockAssembleScanBatch).toHaveBeenCalledTimes(1);
    expect(mockAssembleScanBatch.mock.calls[0][0]).toHaveLength(125);
    expect(mockAssembleScanBatch.mock.calls[0][0][0].symbol).toBe('S0'); // first batch = first 125 symbols
  });

  test('scans the second batch (the real, non-truncated slice) when batchIndex=1', async () => {
    const res = await request(app).post('/contrarian-finder/scan-batch').set('Cookie', authCookie)
      .send({ batchIndex: 1, batchSize: 125, maxBatches: 3 });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(125);
    expect(mockAssembleScanBatch.mock.calls[0][0][0].symbol).toBe('S125');
  });

  test('400 when batchIndex is beyond the real (server-computed) totalBatches, not just the requested maxBatches', async () => {
    // universe of 250 with batchSize 125 only ever produces 2 real batches,
    // regardless of maxBatches=3 being requested - batchIndex 2 must 400.
    const res = await request(app).post('/contrarian-finder/scan-batch').set('Cookie', authCookie)
      .send({ batchIndex: 2, batchSize: 125, maxBatches: 3 });
    expect(res.status).toBe(400);
    expect(mockAssembleScanBatch).not.toHaveBeenCalled();
  });

  test('400 for a negative or non-numeric batchIndex', async () => {
    const res1 = await request(app).post('/contrarian-finder/scan-batch').set('Cookie', authCookie).send({ batchIndex: -1 });
    expect(res1.status).toBe(400);
    const res2 = await request(app).post('/contrarian-finder/scan-batch').set('Cookie', authCookie).send({ batchIndex: 'nope' });
    expect(res2.status).toBe(400);
  });

  test('batchSize/maxBatches/scanDays are clamped before building the batch plan', async () => {
    await request(app).post('/contrarian-finder/scan-batch').set('Cookie', authCookie)
      .send({ batchIndex: 0, batchSize: 5, maxBatches: 999, scanDays: 0 });
    // batchSize clamps up to 10 -> ceil(250/10) batches exist, batchIndex 0 is always valid
    expect(mockAssembleScanBatch.mock.calls[0][0]).toHaveLength(10);
  });

  test('missing batchSize/maxBatches/scanDays fall back to the service defaults', async () => {
    await request(app).post('/contrarian-finder/scan-batch').set('Cookie', authCookie).send({ batchIndex: 0 });
    expect(mockAssembleScanBatch.mock.calls[0][0]).toHaveLength(cf.CF_BATCH);
  });

  test('logs usage on a successful batch scan', async () => {
    const res = await request(app).post('/contrarian-finder/scan-batch').set('Cookie', authCookie).send({ batchIndex: 0 });
    expect(res.status).toBe(200);
    expect(mockLogUsage).toHaveBeenCalledWith('user-1', 'contrarian_finder_scan');
  });

  test('a failed usage log does not turn a successful response into a 500 (fire-and-forget)', async () => {
    mockLogUsage.mockRejectedValue(new Error('usage log db exploded'));
    const res = await request(app).post('/contrarian-finder/scan-batch').set('Cookie', authCookie).send({ batchIndex: 0 });
    expect(res.status).toBe(200);
  });

  test('tickerRefresh is omitted (undefined) when updateAllTickerData is not set - a normal "Run Scan" response shape is unchanged', async () => {
    const res = await request(app).post('/contrarian-finder/scan-batch').set('Cookie', authCookie).send({ batchIndex: 0 });
    expect(res.status).toBe(200);
    expect(res.body.tickerRefresh).toBeUndefined();
    expect(mockRefreshTickerDataBatch).not.toHaveBeenCalled();
  });

  test('"Run Scan (+ Mkt Cap)" (updateAllTickerData: true) piggybacks refreshTickerDataBatch in "all" mode on the same batch, and includes its result', async () => {
    const res = await request(app).post('/contrarian-finder/scan-batch').set('Cookie', authCookie)
      .send({ batchIndex: 0, updateAllTickerData: true });
    expect(res.status).toBe(200);
    expect(res.body.tickerRefresh).toEqual({ updated: 5, skipped: 1 });
    expect(mockRefreshTickerDataBatch).toHaveBeenCalledTimes(1);
    const [batchStocks, key, mode] = mockRefreshTickerDataBatch.mock.calls[0];
    expect(batchStocks).toHaveLength(125); // same batch assembleScanBatch got
    expect(key).toBe('fake-fmp-key');
    expect(mode).toBe('all');
  });
});

describe('POST /contrarian-finder/ticker-data-refresh-batch', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).post('/contrarian-finder/ticker-data-refresh-batch').send({ batchIndex: 0 });
    expect(res.status).toBe(401);
  });

  test('403 for a signed-in user without the contrarian_finder:scan permission', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/contrarian-finder/ticker-data-refresh-batch').set('Cookie', authCookie).send({ batchIndex: 0 });
    expect(res.status).toBe(403);
    expect(mockRefreshTickerDataBatch).not.toHaveBeenCalled();
  });

  test('503 when the caller has no FMP key on file', async () => {
    mockGetDecryptedKey.mockRejectedValue(new userSubscription.MissingUserApiKeyError('No fmp API key on file.'));
    const res = await request(app).post('/contrarian-finder/ticker-data-refresh-batch').set('Cookie', authCookie).send({ batchIndex: 0 });
    expect(res.status).toBe(503);
    expect(mockRefreshTickerDataBatch).not.toHaveBeenCalled();
  });

  test('200 refreshes exactly the requested batch in "missing" mode, no scan/scoring involved at all', async () => {
    const res = await request(app).post('/contrarian-finder/ticker-data-refresh-batch').set('Cookie', authCookie)
      .send({ batchIndex: 0, batchSize: 125, maxBatches: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ batchIndex: 0, totalBatches: 2, universeSize: 250, updated: 5, skipped: 1 });
    expect(mockAssembleScanBatch).not.toHaveBeenCalled(); // the lighter sibling never runs a real scan
    const [batchStocks, key, mode] = mockRefreshTickerDataBatch.mock.calls[0];
    expect(batchStocks).toHaveLength(125);
    expect(key).toBe('fake-fmp-key');
    expect(mode).toBe('missing');
  });

  test('400 when batchIndex is beyond the real (server-computed) totalBatches', async () => {
    const res = await request(app).post('/contrarian-finder/ticker-data-refresh-batch').set('Cookie', authCookie)
      .send({ batchIndex: 2, batchSize: 125, maxBatches: 3 });
    expect(res.status).toBe(400);
    expect(mockRefreshTickerDataBatch).not.toHaveBeenCalled();
  });

  test('400 for a negative or non-numeric batchIndex', async () => {
    const res1 = await request(app).post('/contrarian-finder/ticker-data-refresh-batch').set('Cookie', authCookie).send({ batchIndex: -1 });
    expect(res1.status).toBe(400);
    const res2 = await request(app).post('/contrarian-finder/ticker-data-refresh-batch').set('Cookie', authCookie).send({ batchIndex: 'nope' });
    expect(res2.status).toBe(400);
  });
});

describe('POST /contrarian-finder/last-scan', () => {
  const validBody = { universeSize: 250, scanned: 125, params: { qualityPreset: 'balanced' }, results: [{ symbol: 'S0' }] };

  test('401 without a session cookie', async () => {
    const res = await request(app).post('/contrarian-finder/last-scan').send(validBody);
    expect(res.status).toBe(401);
  });

  test('403 for a signed-in user without the contrarian_finder:scan permission', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/contrarian-finder/last-scan').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(403);
    expect(mockSaveLastScan).not.toHaveBeenCalled();
  });

  test('400 when universeSize/scanned are not numbers or results is not an array', async () => {
    const res1 = await request(app).post('/contrarian-finder/last-scan').set('Cookie', authCookie)
      .send({ ...validBody, universeSize: 'nope' });
    expect(res1.status).toBe(400);
    const res2 = await request(app).post('/contrarian-finder/last-scan').set('Cookie', authCookie)
      .send({ ...validBody, scanned: 'nope' });
    expect(res2.status).toBe(400);
    const res3 = await request(app).post('/contrarian-finder/last-scan').set('Cookie', authCookie)
      .send({ ...validBody, results: 'nope' });
    expect(res3.status).toBe(400);
    expect(mockSaveLastScan).not.toHaveBeenCalled();
  });

  test('200 for a permitted caller, saves under the caller\'s own user id - defaults to the user tier (no contrarian_finder:scan_history)', async () => {
    // beforeEach's mockQuery.mockResolvedValue is a blanket default with no
    // permission_key field, so getUserPermissions() resolves an empty/
    // non-matching list here - the same as a real caller without
    // contrarian_finder:scan_history.
    const res = await request(app).post('/contrarian-finder/last-scan').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockSaveLastScan).toHaveBeenCalledWith('user-1', 'user', {
      universeSize: 250,
      scanned: 125,
      params: { qualityPreset: 'balanced' },
      results: [{ symbol: 'S0' }],
    });
  });

  test('resolves the admin tier when the caller has contrarian_finder:scan_history', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // requirePermission('contrarian_finder:scan') gate
      .mockResolvedValueOnce({ rows: [{ permission_key: 'contrarian_finder:scan' }, { permission_key: 'contrarian_finder:scan_history' }] }); // getUserPermissions
    const res = await request(app).post('/contrarian-finder/last-scan').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(200);
    expect(mockSaveLastScan).toHaveBeenCalledWith('user-1', 'admin', expect.anything());
  });

  test('resolves the user tier when the caller lacks contrarian_finder:scan_history', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // requirePermission('contrarian_finder:scan') gate
      .mockResolvedValueOnce({ rows: [{ permission_key: 'contrarian_finder:scan' }] }); // getUserPermissions, no scan_history
    const res = await request(app).post('/contrarian-finder/last-scan').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(200);
    expect(mockSaveLastScan).toHaveBeenCalledWith('user-1', 'user', expect.anything());
  });
});

describe('GET /contrarian-finder/last-scan', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/contrarian-finder/last-scan');
    expect(res.status).toBe(401);
  });

  test('200 with { lastScan: null } when nothing has been saved yet - no permission check at all', async () => {
    const res = await request(app).get('/contrarian-finder/last-scan').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lastScan: null });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('200 with the last saved scan for a caller WITHOUT contrarian_finder:scan - viewing is not the gated action', async () => {
    const fakeRecord = {
      completedAt: '2026-08-03T14:22:00.000Z',
      universeSize: 250,
      scanned: 250,
      params: { qualityPreset: 'balanced' },
      results: [{ symbol: 'S0' }],
    };
    mockGetLastScan.mockResolvedValue(fakeRecord);
    const res = await request(app).get('/contrarian-finder/last-scan').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lastScan: fakeRecord });
  });
});

describe('GET /contrarian-finder/run-history', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/contrarian-finder/run-history');
    expect(res.status).toBe(401);
  });

  test('403 for a signed-in user without contrarian_finder:view_history (unlike /last-scan, this IS gated)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/contrarian-finder/run-history').set('Cookie', authCookie);
    expect(res.status).toBe(403);
    expect(mockListRunHistory).not.toHaveBeenCalled();
  });

  test('200 with the run list for a caller who has the permission', async () => {
    const fakeList = [
      { id: '2', completedAt: '2026-08-31T10:00:00Z', universeSize: 458, scanned: 458, params: { threshold: 25 } },
      { id: '1', completedAt: '2026-08-29T10:00:00Z', universeSize: 458, scanned: 450, params: { threshold: 30 } },
    ];
    mockListRunHistory.mockResolvedValue(fakeList);
    const res = await request(app).get('/contrarian-finder/run-history').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runs: fakeList });
  });
});

describe('GET /contrarian-finder/run-history/:id', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/contrarian-finder/run-history/1');
    expect(res.status).toBe(401);
  });

  test('403 for a signed-in user without contrarian_finder:view_history', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/contrarian-finder/run-history/1').set('Cookie', authCookie);
    expect(res.status).toBe(403);
    expect(mockGetRunById).not.toHaveBeenCalled();
  });

  test('404 for an id with no matching archived run', async () => {
    mockGetRunById.mockResolvedValue(null);
    const res = await request(app).get('/contrarian-finder/run-history/999').set('Cookie', authCookie);
    expect(res.status).toBe(404);
  });

  test('200 with the full archived record for a real id', async () => {
    const fakeRun = {
      completedAt: '2026-08-29T10:00:00Z', universeSize: 458, scanned: 450,
      params: { threshold: 30 }, results: [{ symbol: 'AAPL', filterFail: false }],
    };
    mockGetRunById.mockResolvedValue(fakeRun);
    const res = await request(app).get('/contrarian-finder/run-history/1').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ run: fakeRun });
    expect(mockGetRunById).toHaveBeenCalledWith('1');
  });
});
