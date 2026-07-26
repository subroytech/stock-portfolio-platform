jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
// Partial mock, not a full jest.mock(...) automock: AnalysisServiceError is a
// real Error subclass exported alongside checkHealth, and the controller's
// catch block relies on `instanceof AnalysisServiceError` — automocking the
// whole module would replace that class with a mock constructor and break
// the instanceof check (same pattern as userSubscription.service's tests).
jest.mock('../src/services/analysisService', () => ({
  ...jest.requireActual('../src/services/analysisService'),
  checkHealth: jest.fn(),
}));

import request from 'supertest';
import * as analysisService from '../src/services/analysisService';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockCheckHealth = analysisService.checkHealth as jest.Mock;

const authCookie = `auth_token=${signToken('user-1')}`;

beforeEach(() => {
  mockCheckHealth.mockReset();
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
