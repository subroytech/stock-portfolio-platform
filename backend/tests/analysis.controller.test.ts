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
}));
jest.mock('../src/services/longTermAnalysisData.service');
jest.mock('../src/services/userSubscription.service', () => ({
  ...jest.requireActual('../src/services/userSubscription.service'),
  getDecryptedKey: jest.fn(),
}));

import request from 'supertest';
import * as analysisService from '../src/services/analysisService';
import * as longTermAnalysisData from '../src/services/longTermAnalysisData.service';
import * as userSubscription from '../src/services/userSubscription.service';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockCheckHealth = analysisService.checkHealth as jest.Mock;
const mockComputeLongTermAnalysis = analysisService.computeLongTermAnalysis as jest.Mock;
const mockFetchLongTermAnalysisData = longTermAnalysisData.fetchLongTermAnalysisData as jest.Mock;
const mockGetDecryptedKey = userSubscription.getDecryptedKey as jest.Mock;

const authCookie = `auth_token=${signToken('user-1')}`;

beforeEach(() => {
  mockCheckHealth.mockReset();
  mockComputeLongTermAnalysis.mockReset();
  mockFetchLongTermAnalysisData.mockReset();
  mockGetDecryptedKey.mockReset();
  mockGetDecryptedKey.mockImplementation((_userId: string, provider: string) =>
    provider === 'fmp' ? Promise.resolve('fake-fmp-key') : Promise.reject(new userSubscription.MissingUserApiKeyError('No finnhub API key on file.')),
  );
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
});
