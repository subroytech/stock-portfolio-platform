jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/contrarianFinder.service', () => ({
  ...jest.requireActual('../src/services/contrarianFinder.service'),
  assembleUniverse: jest.fn(),
  assembleScanBatch: jest.fn(),
}));
jest.mock('../src/services/userSubscription.service', () => ({
  ...jest.requireActual('../src/services/userSubscription.service'),
  getDecryptedKey: jest.fn(),
}));

import request from 'supertest';
import * as cf from '../src/services/contrarianFinder.service';
import * as analysisService from '../src/services/analysisService';
import * as userSubscription from '../src/services/userSubscription.service';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockAssembleUniverse = cf.assembleUniverse as jest.Mock;
const mockAssembleScanBatch = cf.assembleScanBatch as jest.Mock;
const mockGetDecryptedKey = userSubscription.getDecryptedKey as jest.Mock;

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
});

describe('POST /contrarian-finder/scan-batch', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).post('/contrarian-finder/scan-batch').send({ batchIndex: 0 });
    expect(res.status).toBe(401);
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
});
