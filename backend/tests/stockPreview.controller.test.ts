jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/marketData.service');
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

beforeEach(() => {
  mockGetHistorical.mockReset();
  mockGetQuotes.mockReset();
  mockGetDecryptedKey.mockReset();
  mockGetDecryptedKey.mockResolvedValue('fake-fmp-key');
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
    mockGetQuotes.mockResolvedValue({ AAPL: { price: 150, changeDollar: 1, changePercent: 1, name: 'Apple Inc.' } });
    mockGetHistorical.mockResolvedValue([
      { date: '2026-01-01', close: 100, low: 99, volume: 10 },
      { date: '2026-01-03', close: 102, low: 101, volume: 10 },
      { date: '2026-01-02', close: 101, low: 100, volume: 10 },
    ]);
    const res = await request(app).get('/stock-preview/AAPL').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.symbol).toBe('AAPL');
    expect(res.body.quote).toMatchObject({ price: 150, name: 'Apple Inc.' });
    expect(res.body.historical.map((d: { date: string }) => d.date)).toEqual(['2026-01-03', '2026-01-02', '2026-01-01']);
  });

  test('200 with quote:null when the quote call fails - historical data alone is enough', async () => {
    mockGetQuotes.mockRejectedValue(new Error('Invalid or expired FMP API key.'));
    mockGetHistorical.mockResolvedValue([{ date: '2026-01-01', close: 100, low: 99, volume: 10 }]);
    const res = await request(app).get('/stock-preview/AAPL').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.quote).toBeNull();
    expect(res.body.historical).toHaveLength(1);
  });

  test('symbol is uppercased regardless of request casing', async () => {
    mockGetQuotes.mockResolvedValue({});
    mockGetHistorical.mockResolvedValue([]);
    const res = await request(app).get('/stock-preview/aapl').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.symbol).toBe('AAPL');
    expect(mockGetHistorical).toHaveBeenCalledWith('AAPL', 'fake-fmp-key', 96);
  });
});
