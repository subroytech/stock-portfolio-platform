jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
// The new Flex describe blocks below push this file's total real request count well past the
// default 30-per-user/60s limit (express-rate-limit's in-memory store persists across every
// test in this file, all using the same authCookie/user id) - not something these tests are
// meant to exercise, so bypass it here rather than tune the real limiter's config.
jest.mock('../src/middleware/rateLimit', () => ({
  __esModule: true,
  default: [(_req: unknown, _res: unknown, next: () => void) => next(), (_req: unknown, _res: unknown, next: () => void) => next()],
}));
jest.mock('../src/services/marketData.service');
// Partial mock (keeps the real MissingUserApiKeyError class so `instanceof`
// checks inside portfolio.controller.ts are against the real thing) — only
// getDecryptedKey itself is replaced.
jest.mock('../src/services/userSubscription.service', () => ({
  ...jest.requireActual('../src/services/userSubscription.service'),
  getDecryptedKey: jest.fn(),
}));
jest.mock('../src/services/usageTracking.service');
// Partial mock, Flex functions only - every other portfolio.service.ts export (list/create/
// get/update/delete/import/refreshPrices) stays real for this file's existing tests, which
// exercise the real service against a mocked pool/client exactly as before.
jest.mock('../src/services/portfolio.service', () => ({
  ...jest.requireActual('../src/services/portfolio.service'),
  createPortfolioFlex: jest.fn(),
  saveFlexTemplate: jest.fn(),
  changeFlexTemplate: jest.fn(),
}));

import request from 'supertest';
import { pool } from '../src/db/pool';
import * as marketData from '../src/services/marketData.service';
import * as userSubscription from '../src/services/userSubscription.service';
import * as usageTracking from '../src/services/usageTracking.service';
import * as portfolioService from '../src/services/portfolio.service';
import * as portfolioTemplateService from '../src/services/portfolioTemplate.service';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockQuery = pool.query as unknown as jest.Mock;
const mockConnect = pool.connect as unknown as jest.Mock;
const mockGetQuotes = marketData.getQuotes as jest.Mock;
const mockGetHistorical = marketData.getHistorical as jest.Mock;
const mockGetDecryptedKey = userSubscription.getDecryptedKey as jest.Mock;
const mockLogUsage = usageTracking.logUsage as jest.Mock;
const mockCreatePortfolioFlex = portfolioService.createPortfolioFlex as jest.Mock;
const mockSaveFlexTemplate = portfolioService.saveFlexTemplate as jest.Mock;
const mockChangeFlexTemplate = portfolioService.changeFlexTemplate as jest.Mock;

// A real, validly-signed cookie so requests pass through the real
// requireAuth middleware — this suite is testing portfolio.controller.ts,
// not auth, so there's no value in re-mocking auth too.
const authCookie = `auth_token=${signToken('user-1')}`;

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
  mockGetQuotes.mockReset();
  mockGetHistorical.mockReset();
  mockGetHistorical.mockResolvedValue([]); // refreshPrices now also fetches history in parallel
  mockGetDecryptedKey.mockReset();
  mockGetDecryptedKey.mockResolvedValue('fake-fmp-key');
  mockLogUsage.mockReset();
  mockLogUsage.mockResolvedValue(undefined);
  mockCreatePortfolioFlex.mockReset();
  mockSaveFlexTemplate.mockReset();
  mockChangeFlexTemplate.mockReset();
});

describe('auth gating', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/portfolios');
    expect(res.status).toBe(401);
  });
});

describe('GET /portfolios', () => {
  test('200 with the list', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: '1', name: 'Fidelity', broker: null, created_at: 't1', updated_at: 't1' }] });
    const res = await request(app).get('/portfolios').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.portfolios).toHaveLength(1);
  });
});

describe('POST /portfolios', () => {
  test('201 on success', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: '1', name: 'Fidelity', broker: null, created_at: 't1', updated_at: 't1' }] });
    const res = await request(app).post('/portfolios').set('Cookie', authCookie).send({ name: 'Fidelity' });
    expect(res.status).toBe(201);
    expect(res.body.portfolio.name).toBe('Fidelity');
  });

  test('400 on a blank name', async () => {
    const res = await request(app).post('/portfolios').set('Cookie', authCookie).send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  test('409 on a duplicate name', async () => {
    mockQuery.mockRejectedValue({ code: '23505' });
    const res = await request(app).post('/portfolios').set('Cookie', authCookie).send({ name: 'Fidelity' });
    expect(res.status).toBe(409);
  });
});

describe('GET /portfolios/:id', () => {
  test('404 for a portfolio that does not exist or is not owned', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/portfolios/999').set('Cookie', authCookie);
    expect(res.status).toBe(404);
  });
});

describe('PUT /portfolios/:id', () => {
  test('404 for a portfolio that does not exist or is not owned', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).put('/portfolios/999').set('Cookie', authCookie).send({ name: 'New Name' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /portfolios/:id', () => {
  test('200 on success', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: '1' }] });
    const res = await request(app).delete('/portfolios/1').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  test('404 when nothing matched', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).delete('/portfolios/1').set('Cookie', authCookie);
    expect(res.status).toBe(404);
  });
});

describe('POST /portfolios/:id/import', () => {
  // Now gated by requirePermission('portfolio_upload:legacy') (migration 024) - queue the
  // permission-pass response first so it's consumed before any test's own mockQuery/
  // mockConnect sequence, same ordering every other gated-route test file already relies on.
  beforeEach(() => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
  });

  function makeMockClient() {
    const query = jest.fn((sql: string) => {
      if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) return Promise.resolve({});
      if (sql.includes('SELECT id FROM tx_portfolios')) return Promise.resolve({ rows: [{ id: '1' }] });
      if (sql.includes('SELECT symbol, quantity, current_price FROM tx_holdings')) return Promise.resolve({ rows: [] });
      if (sql.startsWith('INSERT INTO tx_uploads')) return Promise.resolve({ rows: [{ id: 'upload-1' }] });
      return Promise.resolve({});
    });
    return { query, release: jest.fn() };
  }

  test('200, reports holdings/cash/actions counts', async () => {
    mockConnect.mockResolvedValue(makeMockClient());
    const csv = 'Symbol,Quantity,Current Price\nAAPL,10,150';
    const res = await request(app).post('/portfolios/1/import').set('Cookie', authCookie).send({ filename: 'x.csv', content: csv });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ holdingsCount: 1, actionsLogged: 1, uploadId: 'upload-1' });
  });

  test('400 on blank content', async () => {
    const res = await request(app).post('/portfolios/1/import').set('Cookie', authCookie).send({ content: '' });
    expect(res.status).toBe(400);
  });

  test('400 when the CSV is missing required columns', async () => {
    const res = await request(app).post('/portfolios/1/import').set('Cookie', authCookie).send({ content: 'Foo,Bar\n1,2' });
    expect(res.status).toBe(400);
  });

  test('dryRun: true returns the parsed preview and never opens a DB transaction', async () => {
    const csv = 'Symbol,Quantity,Current Price\nAAPL,10,150';
    const res = await request(app).post('/portfolios/1/import').set('Cookie', authCookie).send({ filename: 'x.csv', content: csv, dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ preview: true, sourceFormat: 'csv', cashAmount: 0, errors: [] });
    expect(res.body.holdings).toHaveLength(1);
    expect(res.body.holdings[0]).toMatchObject({ symbol: 'AAPL', quantity: 10 });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('dryRun: true still 400s on a malformed CSV, same as a real import', async () => {
    const res = await request(app).post('/portfolios/1/import').set('Cookie', authCookie).send({ content: 'Foo,Bar\n1,2', dryRun: true });
    expect(res.status).toBe(400);
    expect(mockConnect).not.toHaveBeenCalled();
  });
});

describe('POST /portfolios/flex', () => {
  // Gated by requirePermission('portfolio_upload:flex') - queue the permission-pass response
  // first, same ordering the /:id/import describe block above relies on.
  beforeEach(() => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
  });

  const validBody = { name: 'My Portfolio', columnMapping: { symbol: 'Ticker' }, filename: 'f.csv', content: 'Ticker\nAAPL' };

  test('403 without portfolio_upload:flex', async () => {
    mockQuery.mockReset(); // override this describe's own beforeEach permission-pass
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/portfolios/flex').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(403);
    expect(mockCreatePortfolioFlex).not.toHaveBeenCalled();
  });

  test('400 on a blank name', async () => {
    const res = await request(app).post('/portfolios/flex').set('Cookie', authCookie).send({ ...validBody, name: '  ' });
    expect(res.status).toBe(400);
  });

  test('400 on blank content', async () => {
    const res = await request(app).post('/portfolios/flex').set('Cookie', authCookie).send({ ...validBody, content: '' });
    expect(res.status).toBe(400);
  });

  test('400 when neither uploadTemplateId nor columnMapping is given', async () => {
    const res = await request(app).post('/portfolios/flex').set('Cookie', authCookie).send({ name: 'X', filename: 'f.csv', content: 'x' });
    expect(res.status).toBe(400);
    expect(mockCreatePortfolioFlex).not.toHaveBeenCalled();
  });

  test('201 on success', async () => {
    mockCreatePortfolioFlex.mockResolvedValue({
      portfolio: { id: '1', name: 'My Portfolio', broker: null, uploadTemplateId: null, flexTemplateStatus: 'Flex-Err' },
      importResult: { holdingsCount: 1, cashAmount: 0, actionsLogged: 1, uploadId: 'u1' },
    });
    const res = await request(app).post('/portfolios/flex').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.portfolio.flexTemplateStatus).toBe('Flex-Err');
    expect(mockCreatePortfolioFlex).toHaveBeenCalledWith('user-1', {
      name: 'My Portfolio', broker: null, uploadTemplateId: undefined, columnMapping: { symbol: 'Ticker' },
      filename: 'f.csv', content: 'Ticker\nAAPL',
    });
  });

  test('409 on a duplicate portfolio name', async () => {
    mockCreatePortfolioFlex.mockRejectedValue(new portfolioService.PortfolioNameConflictError('exists'));
    const res = await request(app).post('/portfolios/flex').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(409);
  });

  test('404 when uploadTemplateId does not resolve to a real template', async () => {
    mockCreatePortfolioFlex.mockRejectedValue(new portfolioTemplateService.TemplateNotFoundError('gone'));
    const res = await request(app).post('/portfolios/flex').set('Cookie', authCookie).send({ ...validBody, uploadTemplateId: '999', columnMapping: undefined });
    expect(res.status).toBe(404);
  });

  test('dryRun: true returns the parsed preview, requires no name, and never creates a portfolio', async () => {
    const csv = 'Ticker,Shares,Price\nAAPL,10,150';
    const res = await request(app).post('/portfolios/flex').set('Cookie', authCookie).send({
      columnMapping: { symbol: 'Ticker', quantity: 'Shares', currentPrice: 'Price' }, filename: 'f.csv', content: csv, dryRun: true,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ preview: true, cashAmount: 0, errors: [] });
    expect(res.body.holdings).toHaveLength(1);
    expect(mockCreatePortfolioFlex).not.toHaveBeenCalled();
  });

  test('dryRun: true 400s a brand-new-mapping sample file over the template size limit', async () => {
    const oversizedCsv = new Array(203).fill('a,b,c').join('\n');
    const res = await request(app).post('/portfolios/flex').set('Cookie', authCookie).send({
      columnMapping: { symbol: 'Ticker', quantity: 'Shares', currentPrice: 'Price' }, filename: 'f.csv', content: oversizedCsv, dryRun: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('at most 202 rows');
  });

  test('dryRun: true 400s when the mapping does not match the file headers', async () => {
    const res = await request(app).post('/portfolios/flex').set('Cookie', authCookie).send({
      columnMapping: { symbol: 'Nope', quantity: 'Shares', currentPrice: 'Price' }, filename: 'f.csv', content: 'Ticker,Shares,Price\nAAPL,10,150', dryRun: true,
    });
    expect(res.status).toBe(400);
    expect(mockCreatePortfolioFlex).not.toHaveBeenCalled();
  });
});

describe('POST /portfolios/:id/flex-template', () => {
  beforeEach(() => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
  });

  const validBody = { templateName: 'Fidelity CSV', columnMapping: { symbol: 'Ticker' }, samplePreview: [] };

  test('403 without portfolio_upload:flex', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/portfolios/1/flex-template').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(403);
  });

  test('400 when templateName is missing', async () => {
    const res = await request(app).post('/portfolios/1/flex-template').set('Cookie', authCookie).send({ columnMapping: {} });
    expect(res.status).toBe(400);
  });

  test('400 when columnMapping is missing or not an object', async () => {
    const res = await request(app).post('/portfolios/1/flex-template').set('Cookie', authCookie).send({ templateName: 'X' });
    expect(res.status).toBe(400);
  });

  test('200 on success', async () => {
    mockSaveFlexTemplate.mockResolvedValue({
      portfolio: { id: '1', flexTemplateStatus: 'Flex', uploadTemplateId: 'template-1' },
      template: { id: 'template-1', templateName: 'Fidelity CSV', status: 'Pending Approval' },
    });
    const res = await request(app).post('/portfolios/1/flex-template').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.portfolio.flexTemplateStatus).toBe('Flex');
    expect(mockSaveFlexTemplate).toHaveBeenCalledWith('user-1', '1', {
      ...validBody, headerRowIndex: 1, dataStartColumnIndex: 1, footerMarkerColumnIndex: null, footerMarkerText: null,
      cashConfig: null, howToUseDescription: undefined,
    });
  });

  test('409 when the portfolio is not currently unresolved (Flex-Err)', async () => {
    mockSaveFlexTemplate.mockRejectedValue(new portfolioService.FlexTemplateStateError('already resolved'));
    const res = await request(app).post('/portfolios/1/flex-template').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(409);
  });

  test('404 when the portfolio does not exist', async () => {
    mockSaveFlexTemplate.mockRejectedValue(new portfolioService.PortfolioNotFoundError('gone'));
    const res = await request(app).post('/portfolios/1/flex-template').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(404);
  });

  test('409 on a duplicate template name', async () => {
    mockSaveFlexTemplate.mockRejectedValue(new portfolioTemplateService.DuplicateTemplateNameError('exists'));
    const res = await request(app).post('/portfolios/1/flex-template').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(409);
  });
});

describe('PUT /portfolios/:id/flex-template', () => {
  beforeEach(() => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
  });

  const validBody = { columnMapping: { symbol: 'Ticker' }, filename: 'f.csv', content: 'Ticker\nAAPL' };

  test('403 without portfolio_upload:flex', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).put('/portfolios/1/flex-template').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(403);
  });

  test('400 on blank content', async () => {
    const res = await request(app).put('/portfolios/1/flex-template').set('Cookie', authCookie).send({ ...validBody, content: '' });
    expect(res.status).toBe(400);
  });

  test('400 when neither uploadTemplateId nor columnMapping is given', async () => {
    const res = await request(app).put('/portfolios/1/flex-template').set('Cookie', authCookie).send({ filename: 'f.csv', content: 'x' });
    expect(res.status).toBe(400);
  });

  test('200 on success', async () => {
    mockChangeFlexTemplate.mockResolvedValue({
      portfolio: { id: '1', flexTemplateStatus: 'Flex-Err', uploadTemplateId: null },
      importResult: { holdingsCount: 1, cashAmount: 0, actionsLogged: 1, uploadId: 'u1' },
    });
    const res = await request(app).put('/portfolios/1/flex-template').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(200);
    expect(mockChangeFlexTemplate).toHaveBeenCalledWith('user-1', '1', {
      uploadTemplateId: undefined, columnMapping: { symbol: 'Ticker' }, filename: 'f.csv', content: 'Ticker\nAAPL',
    });
  });

  test('409 when the portfolio is not currently resolved (Flex)', async () => {
    mockChangeFlexTemplate.mockRejectedValue(new portfolioService.FlexTemplateStateError('not resolved yet'));
    const res = await request(app).put('/portfolios/1/flex-template').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(409);
  });
});

describe('POST /portfolios/:id/refresh-prices', () => {
  test('200 with updated holdings', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'h1', symbol: 'AAPL', name: 'Apple', quantity: '10', purchase_price: '100', current_price: '100',
          sector: 'Tech', purchase_date: null, cost_basis: '1000', current_value: '1000', gain_loss: '0',
          return_pct: '0', allocation_pct: '100', price_updated_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ price_updated_at: '2026-07-12T00:00:00Z' }] });
    mockGetQuotes.mockResolvedValue({ AAPL: { price: 150, changeDollar: 50, changePercent: 50, name: 'Apple' } });
    mockGetHistorical.mockResolvedValue([{ date: '2026-07-01', close: 145, low: 140 }]);

    const res = await request(app).post('/portfolios/1/refresh-prices').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.holdings[0]).toMatchObject({
      symbol: 'AAPL', currentPrice: 150, priceUpdatedAt: '2026-07-12T00:00:00Z',
      todayChangeDollar: 500, todayChangePercent: 50, // quantity (10) * per-share change (50)
    });
    expect(res.body.performanceHistory.AAPL).toEqual([{ date: '2026-07-01', close: 145, low: 140 }]);
    expect(mockLogUsage).toHaveBeenCalledWith('user-1', 'portfolio_refresh');
  });

  test('a failed usage log does not turn a successful response into a 500 (fire-and-forget)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'h1', symbol: 'AAPL', name: 'Apple', quantity: '10', purchase_price: '100', current_price: '100',
          sector: 'Tech', purchase_date: null, cost_basis: '1000', current_value: '1000', gain_loss: '0',
          return_pct: '0', allocation_pct: '100', price_updated_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ price_updated_at: '2026-07-12T00:00:00Z' }] });
    mockGetQuotes.mockResolvedValue({ AAPL: { price: 150, changeDollar: 50, changePercent: 50, name: 'Apple' } });
    mockLogUsage.mockRejectedValue(new Error('usage log db exploded'));

    const res = await request(app).post('/portfolios/1/refresh-prices').set('Cookie', authCookie);
    expect(res.status).toBe(200);
  });

  test('404 for a portfolio that does not exist or is not owned', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/portfolios/999/refresh-prices').set('Cookie', authCookie);
    expect(res.status).toBe(404);
  });

  test('503 when the caller has no FMP key on file', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'h1', symbol: 'AAPL', name: 'Apple', quantity: '10', purchase_price: '100', current_price: '100',
          sector: 'Tech', purchase_date: null, cost_basis: '1000', current_value: '1000', gain_loss: '0',
          return_pct: '0', allocation_pct: '100', price_updated_at: null,
        }],
      });
    mockGetDecryptedKey.mockRejectedValue(new userSubscription.MissingUserApiKeyError('No fmp API key on file.'));
    const res = await request(app).post('/portfolios/1/refresh-prices').set('Cookie', authCookie);
    expect(res.status).toBe(503);
    expect(mockGetQuotes).not.toHaveBeenCalled();
  });
});
