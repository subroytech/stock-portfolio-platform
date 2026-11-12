jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/flexQuota.service', () => ({
  getEffectivePendingTemplateLimit: jest.fn(),
  getEffectiveApprovedTemplateLimit: jest.fn(),
  getEffectivePortfolioLimit: jest.fn(),
}));
jest.mock('../src/services/portfolioTemplate.service', () => ({
  ...jest.requireActual('../src/services/portfolioTemplate.service'),
  countTemplatesByStatus: jest.fn(),
}));
jest.mock('../src/services/portfolio.service', () => ({
  ...jest.requireActual('../src/services/portfolio.service'),
  countFlexPortfolios: jest.fn(),
}));
jest.mock('../src/middleware/rateLimit', () => ({
  __esModule: true,
  default: [(_req: unknown, _res: unknown, next: () => void) => next(), (_req: unknown, _res: unknown, next: () => void) => next()],
}));

import request from 'supertest';
import * as flexQuota from '../src/services/flexQuota.service';
import * as portfolioTemplateService from '../src/services/portfolioTemplate.service';
import * as portfolioService from '../src/services/portfolio.service';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockGetEffectivePendingTemplateLimit = flexQuota.getEffectivePendingTemplateLimit as jest.Mock;
const mockGetEffectiveApprovedTemplateLimit = flexQuota.getEffectiveApprovedTemplateLimit as jest.Mock;
const mockGetEffectivePortfolioLimit = flexQuota.getEffectivePortfolioLimit as jest.Mock;
const mockCountTemplatesByStatus = portfolioTemplateService.countTemplatesByStatus as jest.Mock;
const mockCountFlexPortfolios = portfolioService.countFlexPortfolios as jest.Mock;

const authCookie = `auth_token=${signToken('user-1')}`;

beforeEach(() => {
  mockGetEffectivePendingTemplateLimit.mockReset().mockResolvedValue(2);
  mockGetEffectiveApprovedTemplateLimit.mockReset().mockResolvedValue(5);
  mockGetEffectivePortfolioLimit.mockReset().mockResolvedValue(6);
  mockCountTemplatesByStatus.mockReset().mockResolvedValue({ pending: 1, approved: 3 });
  mockCountFlexPortfolios.mockReset().mockResolvedValue(4);
});

describe('GET /flex-quota/status', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/flex-quota/status');
    expect(res.status).toBe(401);
  });

  test('200 with current/limit for all 3 metrics', async () => {
    const res = await request(app).get('/flex-quota/status').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      pendingTemplates: { current: 1, limit: 2 },
      approvedTemplates: { current: 3, limit: 5 },
      flexPortfolios: { current: 4, limit: 6 },
    });
  });

  test('reflects a per-user override raising a limit', async () => {
    mockGetEffectivePortfolioLimit.mockResolvedValue(10);
    const res = await request(app).get('/flex-quota/status').set('Cookie', authCookie);
    expect(res.body.flexPortfolios).toEqual({ current: 4, limit: 10 });
  });
});
