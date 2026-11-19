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

const mockGetQuotes = marketData.getQuotes as jest.Mock;
const mockGetDecryptedKey = userSubscription.getDecryptedKey as jest.Mock;
const mockLogUsage = usageTracking.logUsage as jest.Mock;

const authCookie = `auth_token=${signToken('user-1')}`;

beforeEach(() => {
  mockGetQuotes.mockReset();
  mockGetDecryptedKey.mockReset();
  mockGetDecryptedKey.mockResolvedValue('fake-fmp-key');
  mockLogUsage.mockReset().mockResolvedValue(undefined);
});

describe('GET /quotes', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/quotes?symbols=AAPL');
    expect(res.status).toBe(401);
  });

  test('400 when the symbols query param is missing', async () => {
    const res = await request(app).get('/quotes').set('Cookie', authCookie);
    expect(res.status).toBe(400);
    expect(mockGetQuotes).not.toHaveBeenCalled();
  });

  test('400 when symbols is present but empty after trimming', async () => {
    const res = await request(app).get('/quotes?symbols=%20,%20').set('Cookie', authCookie);
    expect(res.status).toBe(400);
  });

  test('503 when the caller has no FMP key on file, and logs no usage', async () => {
    mockGetDecryptedKey.mockRejectedValue(new userSubscription.MissingUserApiKeyError('No fmp API key on file.'));
    const res = await request(app).get('/quotes?symbols=AAPL').set('Cookie', authCookie);
    expect(res.status).toBe(503);
    expect(mockGetQuotes).not.toHaveBeenCalled();
    expect(mockLogUsage).not.toHaveBeenCalled();
  });

  test('200 returns quotes uppercased/deduped-by-trim from the comma-separated symbols param', async () => {
    mockGetQuotes.mockResolvedValue({ quotes: { AAPL: { price: 150 }, MSFT: { price: 300 } }, realCalls: 2 });
    const res = await request(app).get('/quotes?symbols=aapl, msft').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quotes: { AAPL: { price: 150 }, MSFT: { price: 300 } } });
    expect(mockGetQuotes).toHaveBeenCalledWith(['AAPL', 'MSFT'], 'fake-fmp-key');
  });

  test('logs real usage - getQuotes()\'s own realCalls, not a flat per-symbol count', async () => {
    // 3 symbols requested, but only 2 were real FMP calls - the third was a same-day cache hit.
    mockGetQuotes.mockResolvedValue({ quotes: { AAPL: { price: 150 } }, realCalls: 2 });
    await request(app).get('/quotes?symbols=AAPL,MSFT,GOOG').set('Cookie', authCookie);
    expect(mockLogUsage).toHaveBeenCalledWith('user-1', 'quotes', { fmp_quote: 2 });
  });
});
