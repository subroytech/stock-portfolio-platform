jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/marketData.service');

import request from 'supertest';
import { pool } from '../src/db/pool';
import * as marketData from '../src/services/marketData.service';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockQuery = pool.query as unknown as jest.Mock;
const mockConnect = pool.connect as unknown as jest.Mock;
const mockGetQuotes = marketData.getQuotes as jest.Mock;

// A real, validly-signed cookie so requests pass through the real
// requireAuth middleware — this suite is testing portfolio.controller.ts,
// not auth, so there's no value in re-mocking auth too.
const authCookie = `auth_token=${signToken('user-1')}`;

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
  mockGetQuotes.mockReset();
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

    const res = await request(app).post('/portfolios/1/refresh-prices').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.holdings[0]).toMatchObject({ symbol: 'AAPL', currentPrice: 150, priceUpdatedAt: '2026-07-12T00:00:00Z' });
  });

  test('404 for a portfolio that does not exist or is not owned', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/portfolios/999/refresh-prices').set('Cookie', authCookie);
    expect(res.status).toBe(404);
  });
});
