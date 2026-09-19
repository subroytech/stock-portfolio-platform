jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/marketData.service');
jest.mock('../src/services/userSubscription.service', () => ({
  ...jest.requireActual('../src/services/userSubscription.service'),
  getDecryptedKey: jest.fn(),
}));
jest.mock('../src/services/usageTracking.service');

import request from 'supertest';
import * as marketData from '../src/services/marketData.service';
import * as userSubscription from '../src/services/userSubscription.service';
import * as usageTracking from '../src/services/usageTracking.service';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockGetHistorical = marketData.getHistorical as jest.Mock;
const mockGetQuotes = marketData.getQuotes as jest.Mock;
const mockGetDecryptedKey = userSubscription.getDecryptedKey as jest.Mock;
const mockLogUsage = usageTracking.logUsage as jest.Mock;

const authCookie = `auth_token=${signToken('user-1')}`;

beforeEach(() => {
  mockGetHistorical.mockReset();
  mockGetQuotes.mockReset();
  mockGetDecryptedKey.mockReset();
  mockGetDecryptedKey.mockResolvedValue('fake-fmp-key');
  mockLogUsage.mockReset().mockResolvedValue(undefined);
});

describe('GET /stock-preview/:symbol', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/stock-preview/AAPL');
    expect(res.status).toBe(401);
  });

  test('400 for a blank symbol', async () => {
    const res = await request(app).get('/stock-preview/%20').set('Cookie', authCookie);
    expect(res.status).toBe(400);
  });

  test('503 when the caller has no FMP key on file', async () => {
    mockGetDecryptedKey.mockRejectedValue(new userSubscription.MissingUserApiKeyError('No fmp API key on file.'));
    const res = await request(app).get('/stock-preview/AAPL').set('Cookie', authCookie);
    expect(res.status).toBe(503);
    expect(mockGetHistorical).not.toHaveBeenCalled();
  });

  test('200 returns the raw quote + a newest-first sorted historical series', async () => {
    mockGetQuotes.mockResolvedValue({ quotes: { AAPL: { price: 150, changeDollar: 1, changePercent: 1, name: 'Apple Inc.' } }, realCalls: 1 });
    mockGetHistorical.mockResolvedValue({
      bars: [
        { date: '2026-01-01', close: 100, low: 99, volume: 10 },
        { date: '2026-01-03', close: 102, low: 101, volume: 10 },
        { date: '2026-01-02', close: 101, low: 100, volume: 10 },
      ],
      realCalls: 1,
    });
    const res = await request(app).get('/stock-preview/AAPL').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.symbol).toBe('AAPL');
    expect(res.body.quote).toMatchObject({ price: 150, name: 'Apple Inc.' });
    expect(res.body.historical.map((d: { date: string }) => d.date)).toEqual(['2026-01-03', '2026-01-02', '2026-01-01']);
  });

  test('logs real usage - 1 historical + 1 quote FMP call, shared by every caller of this endpoint', async () => {
    mockGetQuotes.mockResolvedValue({ quotes: { AAPL: { price: 150 } }, realCalls: 1 });
    mockGetHistorical.mockResolvedValue({ bars: [{ date: '2026-01-01', close: 100, low: 99, volume: 10 }], realCalls: 1 });
    await request(app).get('/stock-preview/AAPL').set('Cookie', authCookie);
    expect(mockLogUsage).toHaveBeenCalledWith('user-1', 'stock_preview', { fmp_historical: 1, fmp_quote: 1 });
  });

  test('logs a zero call count for whichever leg was served from the day-cache', async () => {
    mockGetQuotes.mockResolvedValue({ quotes: { AAPL: { price: 150 } }, realCalls: 0 });
    mockGetHistorical.mockResolvedValue({ bars: [{ date: '2026-01-01', close: 100, low: 99, volume: 10 }], realCalls: 0 });
    await request(app).get('/stock-preview/AAPL').set('Cookie', authCookie);
    expect(mockLogUsage).toHaveBeenCalledWith('user-1', 'stock_preview', { fmp_historical: 0, fmp_quote: 0 });
  });

  test('200 with quote:null when the quote call fails - historical data alone is enough', async () => {
    mockGetQuotes.mockRejectedValue(new Error('Invalid or expired FMP API key.'));
    mockGetHistorical.mockResolvedValue({ bars: [{ date: '2026-01-01', close: 100, low: 99, volume: 10 }], realCalls: 1 });
    const res = await request(app).get('/stock-preview/AAPL').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.quote).toBeNull();
    expect(res.body.historical).toHaveLength(1);
  });

  test('a rejected quote call still logs 1 real quote call - a cache hit can never reach a rejection', async () => {
    mockGetQuotes.mockRejectedValue(new Error('Invalid or expired FMP API key.'));
    mockGetHistorical.mockResolvedValue({ bars: [{ date: '2026-01-01', close: 100, low: 99, volume: 10 }], realCalls: 1 });
    await request(app).get('/stock-preview/AAPL').set('Cookie', authCookie);
    expect(mockLogUsage).toHaveBeenCalledWith('user-1', 'stock_preview', { fmp_historical: 1, fmp_quote: 1 });
  });

  test('symbol is uppercased regardless of request casing', async () => {
    mockGetQuotes.mockResolvedValue({ quotes: {}, realCalls: 0 });
    mockGetHistorical.mockResolvedValue({ bars: [], realCalls: 0 });
    const res = await request(app).get('/stock-preview/aapl').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.symbol).toBe('AAPL');
    expect(mockGetHistorical).toHaveBeenCalledWith('AAPL', 'fake-fmp-key', 96);
  });
});
