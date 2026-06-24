const request = require('supertest');
const app = require('../src/app');

describe('app routing (no DB, no real FMP key required)', () => {
  test('GET /quotes without symbols returns 400', async () => {
    const res = await request(app).get('/quotes');
    expect(res.status).toBe(400);
  });

  test('GET /quotes?symbols=AAPL returns 503 when FMP_API_KEY is unset', async () => {
    const res = await request(app).get('/quotes?symbols=AAPL');
    expect(res.status).toBe(503);
  });

  test('POST /contrarian-finder/scan returns 503 when FMP_API_KEY is unset', async () => {
    const res = await request(app).post('/contrarian-finder/scan').send({});
    expect(res.status).toBe(503);
  });

  test('unknown route returns 404', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
  });
});
