jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/marketData.service');
// Partial mock (keeps the real MissingUserApiKeyError class so `instanceof`
// checks inside momentum.controller.ts are against the real thing) — only
// getDecryptedKey itself is replaced.
jest.mock('../src/services/userSubscription.service', () => ({
  ...jest.requireActual('../src/services/userSubscription.service'),
  getDecryptedKey: jest.fn(),
}));

import request from 'supertest';
import * as marketData from '../src/services/marketData.service';
import * as userSubscription from '../src/services/userSubscription.service';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockGetHistorical = marketData.getHistorical as jest.Mock;
const mockGetQuotes = marketData.getQuotes as jest.Mock;
const mockGetDecryptedKey = userSubscription.getDecryptedKey as jest.Mock;

const authCookie = `auth_token=${signToken('user-1')}`;

function makeBars(count: number) {
  // newest-first, strictly increasing oldest->newest, matching the
  // momentum.service.test.ts convention.
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(2026, 0, count - i).toISOString().slice(0, 10),
    close: count - i,
    low: count - i - 1,
    volume: 100,
  }));
}

beforeEach(() => {
  mockGetHistorical.mockReset();
  mockGetQuotes.mockReset();
  mockGetDecryptedKey.mockReset();
  mockGetDecryptedKey.mockResolvedValue('fake-fmp-key');
});

describe('GET /momentum/:symbol', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/momentum/AAPL');
    expect(res.status).toBe(401);
  });

  test('400 for a blank symbol', async () => {
    const res = await request(app).get('/momentum/%20').set('Cookie', authCookie);
    expect(res.status).toBe(400);
  });

  test('503 when the caller has no FMP key on file', async () => {
    mockGetDecryptedKey.mockRejectedValue(new userSubscription.MissingUserApiKeyError('No fmp API key on file.'));
    const res = await request(app).get('/momentum/AAPL').set('Cookie', authCookie);
    expect(res.status).toBe(503);
    expect(mockGetHistorical).not.toHaveBeenCalled();
  });

  test('400 when fewer than 30 trading days are available', async () => {
    mockGetHistorical.mockResolvedValue(makeBars(20));
    mockGetQuotes.mockResolvedValue({});
    const res = await request(app).get('/momentum/AAPL').set('Cookie', authCookie);
    expect(res.status).toBe(400);
  });

  test('200 with the assembled analysis, quote used as a best-effort price', async () => {
    mockGetHistorical.mockResolvedValue(makeBars(60));
    mockGetQuotes.mockResolvedValue({ AAPL: { price: 999, changeDollar: 1, changePercent: 1, name: 'Apple Inc.' } });
    const res = await request(app).get('/momentum/AAPL').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.symbol).toBe('AAPL');
    expect(res.body.name).toBe('Apple Inc.');
    expect(res.body.analysis.price).toBe(999);
    expect(res.body.analysis.score.total).toBe(
      res.body.analysis.score.rsi + res.body.analysis.score.macd
      + res.body.analysis.score.volume + res.body.analysis.score.trend + res.body.analysis.score.riskReward,
    );
  });

  test('200 even when the quote call fails - falls back to the latest close as price', async () => {
    mockGetHistorical.mockResolvedValue(makeBars(60));
    mockGetQuotes.mockRejectedValue(new Error('Invalid or expired FMP API key.'));
    const res = await request(app).get('/momentum/AAPL').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.name).toBeNull();
    expect(res.body.analysis.price).toBe(60);
  });

  test('symbol is uppercased regardless of request casing', async () => {
    mockGetHistorical.mockResolvedValue(makeBars(60));
    mockGetQuotes.mockResolvedValue({});
    const res = await request(app).get('/momentum/aapl').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.symbol).toBe('AAPL');
    expect(mockGetHistorical).toHaveBeenCalledWith('AAPL', 'fake-fmp-key', 130);
  });
});
