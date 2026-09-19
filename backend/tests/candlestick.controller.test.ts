jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
// Partial mocks, not full automocks - CandlestickRateLimitExceededError/MissingUserApiKeyError
// are real Error subclasses the controller checks via `instanceof`, same pattern
// momentum.controller.test.ts already uses for AnalysisServiceError/MissingUserApiKeyError.
jest.mock('../src/services/candlestick.service', () => ({
  ...jest.requireActual('../src/services/candlestick.service'),
  listCachedSymbols: jest.fn(),
  getSnapshot: jest.fn(),
  refresh: jest.fn(),
}));
jest.mock('../src/services/userSubscription.service', () => ({
  ...jest.requireActual('../src/services/userSubscription.service'),
  getDecryptedKey: jest.fn(),
}));

import request from 'supertest';
import * as candlestickService from '../src/services/candlestick.service';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockListCachedSymbols = candlestickService.listCachedSymbols as jest.Mock;
const mockGetSnapshot = candlestickService.getSnapshot as jest.Mock;
const mockRefresh = candlestickService.refresh as jest.Mock;

const authCookie = `auth_token=${signToken('user-1')}`;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /candlestick/cached-symbols', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/candlestick/cached-symbols');
    expect(res.status).toBe(401);
  });

  test('200 with the list', async () => {
    mockListCachedSymbols.mockResolvedValue([{ symbol: 'AAPL', updatedAt: 'x', isFresh: true }]);
    const res = await request(app).get('/candlestick/cached-symbols').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.symbols).toEqual([{ symbol: 'AAPL', updatedAt: 'x', isFresh: true }]);
  });
});

describe('GET /candlestick/:symbol/:interval', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/candlestick/AAPL/5min');
    expect(res.status).toBe(401);
  });

  test('400 for an invalid interval', async () => {
    const res = await request(app).get('/candlestick/AAPL/1min').set('Cookie', authCookie);
    expect(res.status).toBe(400);
    expect(mockGetSnapshot).not.toHaveBeenCalled();
  });

  test('404 when nothing is cached yet for this symbol/interval', async () => {
    mockGetSnapshot.mockResolvedValue(null);
    const res = await request(app).get('/candlestick/AAPL/5min').set('Cookie', authCookie);
    expect(res.status).toBe(404);
  });

  test('200 with the cached snapshot, symbol uppercased regardless of request casing', async () => {
    mockGetSnapshot.mockResolvedValue({ bars: [], indicators: {}, updatedAt: 'x', isFresh: true });
    const res = await request(app).get('/candlestick/aapl/1day').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(mockGetSnapshot).toHaveBeenCalledWith('AAPL', '1day');
  });
});

describe('POST /candlestick/:symbol/:interval/refresh', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).post('/candlestick/AAPL/5min/refresh');
    expect(res.status).toBe(401);
  });

  test('400 for an invalid interval', async () => {
    const res = await request(app).post('/candlestick/AAPL/1min/refresh').set('Cookie', authCookie);
    expect(res.status).toBe(400);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  test('200 with the fresh snapshot on success, passing the caller\'s own user id', async () => {
    mockRefresh.mockResolvedValue({ bars: [], indicators: {}, updatedAt: 'x', isFresh: true });
    const res = await request(app).post('/candlestick/AAPL/5min/refresh').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(mockRefresh).toHaveBeenCalledWith('AAPL', '5min', 'user-1');
  });

  test('429 when the rate limit is exceeded', async () => {
    const candlestickServiceReal = jest.requireActual('../src/services/candlestick.service');
    mockRefresh.mockRejectedValue(new candlestickServiceReal.CandlestickRateLimitExceededError('limit reached'));
    const res = await request(app).post('/candlestick/AAPL/5min/refresh').set('Cookie', authCookie);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('limit reached');
  });

  test('503 when the caller has no FMP key on file', async () => {
    const userSubscriptionReal = jest.requireActual('../src/services/userSubscription.service');
    mockRefresh.mockRejectedValue(new userSubscriptionReal.MissingUserApiKeyError('No fmp API key on file.'));
    const res = await request(app).post('/candlestick/AAPL/5min/refresh').set('Cookie', authCookie);
    expect(res.status).toBe(503);
  });
});
