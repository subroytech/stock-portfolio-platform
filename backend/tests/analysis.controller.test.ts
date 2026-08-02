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

import request from 'supertest';
import * as analysisService from '../src/services/analysisService';
import * as longTermAnalysisData from '../src/services/longTermAnalysisData.service';
import * as contrarianComebackData from '../src/services/contrarianComebackData.service';
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

  test('logs usage on a successful analysis', async () => {
    mockFetchLongTermAnalysisData.mockResolvedValue({ symbol: 'AAPL' });
    mockComputeLongTermAnalysis.mockResolvedValue({ symbol: 'AAPL' });
    const res = await request(app).get('/analysis/long-term/AAPL').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(mockLogUsage).toHaveBeenCalledWith('user-1', 'long_term_analysis');
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
    mockFetchContrarianComebackData.mockResolvedValue({ symbol: 'AAPL' });
    mockComputeContrarianComebackGate.mockResolvedValue({ symbol: 'AAPL', check1Pass: true, failedCheck: null });
    const res = await request(app).get('/analysis/contrarian-comeback/aapl/gate').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ symbol: 'AAPL', check1Pass: true, failedCheck: null });
    expect(mockFetchContrarianComebackData).toHaveBeenCalledWith('AAPL', 'fake-fmp-key', undefined);
    // Gate is a lightweight preview step, not a full run - only the POST
    // .../submit below counts as "usage" for tracking purposes.
    expect(mockLogUsage).not.toHaveBeenCalled();
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

  test('logs usage on a successful submit', async () => {
    mockFetchContrarianComebackData.mockResolvedValue({ symbol: 'AAPL' });
    mockComputeContrarianComebackSubmit.mockResolvedValue({ symbol: 'AAPL', format: 'A' });
    const res = await request(app).post('/analysis/contrarian-comeback/AAPL').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(200);
    expect(mockLogUsage).toHaveBeenCalledWith('user-1', 'contrarian_comeback');
  });

  test('a failed usage log does not turn a successful response into a 500 (fire-and-forget)', async () => {
    mockFetchContrarianComebackData.mockResolvedValue({ symbol: 'AAPL' });
    mockComputeContrarianComebackSubmit.mockResolvedValue({ symbol: 'AAPL', format: 'A' });
    mockLogUsage.mockRejectedValue(new Error('usage log db exploded'));
    const res = await request(app).post('/analysis/contrarian-comeback/AAPL').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(200);
  });
});
