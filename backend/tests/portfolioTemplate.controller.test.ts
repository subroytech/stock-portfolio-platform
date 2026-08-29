jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
// This file's total real request count now exceeds the default 30-per-user/60s limit
// (express-rate-limit's in-memory store persists across every test in this file, all using the
// same authCookie/user id) - not something these tests are meant to exercise, so bypass it here
// rather than tune the real limiter's config. Same precedent as portfolio.controller.test.ts.
jest.mock('../src/middleware/rateLimit', () => ({
  __esModule: true,
  default: [(_req: unknown, _res: unknown, next: () => void) => next(), (_req: unknown, _res: unknown, next: () => void) => next()],
}));
jest.mock('../src/services/portfolioTemplate.service', () => ({
  ...jest.requireActual('../src/services/portfolioTemplate.service'),
  listApprovedTemplates: jest.fn(),
  listMyPending: jest.fn(),
  listAllTemplates: jest.fn(),
  createTemplate: jest.fn(),
  setTemplateStatus: jest.fn(),
  getTemplateDetail: jest.fn(),
  deleteTemplate: jest.fn(),
}));
jest.mock('../src/services/portfolio.service', () => ({
  ...jest.requireActual('../src/services/portfolio.service'),
  listBoundPortfolios: jest.fn(),
  deleteBoundPortfolio: jest.fn(),
  listUnattachedFlexPortfolios: jest.fn(),
  deleteUnattachedFlexPortfolio: jest.fn(),
}));

import request from 'supertest';
import { pool } from '../src/db/pool';
import * as portfolioTemplateService from '../src/services/portfolioTemplate.service';
import * as portfolioService from '../src/services/portfolio.service';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockQuery = pool.query as unknown as jest.Mock;
const mockListApproved = portfolioTemplateService.listApprovedTemplates as jest.Mock;
const mockListMyPending = portfolioTemplateService.listMyPending as jest.Mock;
const mockListAll = portfolioTemplateService.listAllTemplates as jest.Mock;
const mockCreate = portfolioTemplateService.createTemplate as jest.Mock;
const mockSetStatus = portfolioTemplateService.setTemplateStatus as jest.Mock;
const mockGetDetail = portfolioTemplateService.getTemplateDetail as jest.Mock;
const mockDelete = portfolioTemplateService.deleteTemplate as jest.Mock;
const mockListBoundPortfolios = portfolioService.listBoundPortfolios as jest.Mock;
const mockDeleteBoundPortfolio = portfolioService.deleteBoundPortfolio as jest.Mock;
const mockListUnattached = portfolioService.listUnattachedFlexPortfolios as jest.Mock;
const mockDeleteUnattached = portfolioService.deleteUnattachedFlexPortfolio as jest.Mock;

const authCookie = `auth_token=${signToken('user-1')}`;

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] }); // requirePermission gate defaults to passing
  mockListApproved.mockReset();
  mockListMyPending.mockReset();
  mockListAll.mockReset();
  mockCreate.mockReset();
  mockSetStatus.mockReset();
  mockGetDetail.mockReset();
  mockDelete.mockReset();
  mockListBoundPortfolios.mockReset();
  mockDeleteBoundPortfolio.mockReset();
  mockListUnattached.mockReset();
  mockDeleteUnattached.mockReset();
});

describe('GET /portfolio-templates', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/portfolio-templates');
    expect(res.status).toBe(401);
  });

  test('403 without portfolio_upload:flex', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/portfolio-templates').set('Cookie', authCookie);
    expect(res.status).toBe(403);
    expect(mockListApproved).not.toHaveBeenCalled();
  });

  test('200 with the approved list, passing along a search query param', async () => {
    mockListApproved.mockResolvedValue([{ id: '1', templateName: 'Fidelity', status: 'Approved', createdBy: 'user-1', createdAt: '2026-08-06T00:00:00Z' }]);
    const res = await request(app).get('/portfolio-templates?search=fid').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(1);
    expect(mockListApproved).toHaveBeenCalledWith('user-1', 'fid');
  });

  test('omits search when not provided', async () => {
    mockListApproved.mockResolvedValue([]);
    await request(app).get('/portfolio-templates').set('Cookie', authCookie);
    expect(mockListApproved).toHaveBeenCalledWith('user-1', undefined);
  });
});

describe('GET /portfolio-templates/mine/pending', () => {
  test('200 with the caller\'s own pending templates', async () => {
    mockListMyPending.mockResolvedValue([{ id: '2', templateName: 'Draft', status: 'Pending Approval', createdBy: 'user-1', createdAt: '2026-08-06T00:00:00Z' }]);
    const res = await request(app).get('/portfolio-templates/mine/pending').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(1);
    expect(mockListMyPending).toHaveBeenCalledWith('user-1');
  });
});

describe('GET /portfolio-templates/admin/all', () => {
  test('403 without portfolio_template:manage_status', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/portfolio-templates/admin/all').set('Cookie', authCookie);
    expect(res.status).toBe(403);
    expect(mockListAll).not.toHaveBeenCalled();
  });

  test('200 with every template regardless of status', async () => {
    mockListAll.mockResolvedValue([
      { id: '1', templateName: 'Pending One', status: 'Pending Approval', createdBy: 'user-1', createdAt: '2026-08-06T00:00:00Z' },
      { id: '2', templateName: 'Approved One', status: 'Approved', createdBy: 'user-2', createdAt: '2026-08-05T00:00:00Z' },
    ]);
    const res = await request(app).get('/portfolio-templates/admin/all').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(2);
  });
});

describe('POST /portfolio-templates', () => {
  const validBody = { templateName: 'Fidelity CSV', columnMapping: { symbol: 'Ticker' }, samplePreview: [] };

  test('400 when templateName is missing', async () => {
    const res = await request(app).post('/portfolio-templates').set('Cookie', authCookie).send({ columnMapping: {} });
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('400 when columnMapping is missing or not an object', async () => {
    const res1 = await request(app).post('/portfolio-templates').set('Cookie', authCookie).send({ templateName: 'X' });
    expect(res1.status).toBe(400);
    const res2 = await request(app).post('/portfolio-templates').set('Cookie', authCookie).send({ templateName: 'X', columnMapping: [] });
    expect(res2.status).toBe(400);
  });

  test('201 on success, saved under the caller\'s own user id', async () => {
    mockCreate.mockResolvedValue({ id: '1', templateName: 'Fidelity CSV', status: 'Pending Approval', createdBy: 'user-1', createdAt: '2026-08-06T00:00:00Z' });
    const res = await request(app).post('/portfolio-templates').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith({
      templateName: 'Fidelity CSV', columnMapping: { symbol: 'Ticker' }, samplePreview: [], createdBy: 'user-1',
      headerRowIndex: 1, dataStartColumnIndex: 1, footerMarkerColumnIndex: null, footerMarkerText: null,
      cashConfig: null, howToUseDescription: undefined,
    });
  });

  test('400 when the service rejects an invalid name', async () => {
    mockCreate.mockRejectedValue(new portfolioTemplateService.InvalidTemplateNameError('too short'));
    const res = await request(app).post('/portfolio-templates').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(400);
  });

  test('409 on a duplicate template name', async () => {
    mockCreate.mockRejectedValue(new portfolioTemplateService.DuplicateTemplateNameError('exists'));
    const res = await request(app).post('/portfolio-templates').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(409);
  });
});

describe('PUT /portfolio-templates/:id/status', () => {
  test('400 for an invalid status value', async () => {
    const res = await request(app).put('/portfolio-templates/1/status').set('Cookie', authCookie).send({ status: 'Deleted' });
    expect(res.status).toBe(400);
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  test('200 on success', async () => {
    const res = await request(app).put('/portfolio-templates/1/status').set('Cookie', authCookie).send({ status: 'Approved' });
    expect(res.status).toBe(200);
    expect(mockSetStatus).toHaveBeenCalledWith('1', 'Approved', 'user-1');
  });

  test('404 when the template does not exist', async () => {
    mockSetStatus.mockRejectedValue(new portfolioTemplateService.TemplateNotFoundError('gone'));
    const res = await request(app).put('/portfolio-templates/999/status').set('Cookie', authCookie).send({ status: 'Rejected' });
    expect(res.status).toBe(404);
  });
});

describe('GET /portfolio-templates/:id', () => {
  test('200 with the full template detail', async () => {
    mockGetDetail.mockResolvedValue({ id: '1', templateName: 'Fidelity', status: 'Pending Approval', columnMapping: { symbol: 'Ticker' } });
    const res = await request(app).get('/portfolio-templates/1').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.template.columnMapping).toEqual({ symbol: 'Ticker' });
  });

  test('404 when not found', async () => {
    mockGetDetail.mockRejectedValue(new portfolioTemplateService.TemplateNotFoundError('gone'));
    const res = await request(app).get('/portfolio-templates/999').set('Cookie', authCookie);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /portfolio-templates/:id', () => {
  test('200 on success', async () => {
    mockDelete.mockResolvedValue(undefined);
    const res = await request(app).delete('/portfolio-templates/1').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith('1');
  });

  test('404 when not found', async () => {
    mockDelete.mockRejectedValue(new portfolioTemplateService.TemplateNotFoundError('gone'));
    const res = await request(app).delete('/portfolio-templates/999').set('Cookie', authCookie);
    expect(res.status).toBe(404);
  });

  test('409 when the template is Approved', async () => {
    mockDelete.mockRejectedValue(new portfolioTemplateService.TemplateStatusError('cannot delete an Approved template'));
    const res = await request(app).delete('/portfolio-templates/1').set('Cookie', authCookie);
    expect(res.status).toBe(409);
  });

  test('409 when the template is still bound to a portfolio', async () => {
    mockDelete.mockRejectedValue(new portfolioTemplateService.TemplateInUseError('still bound'));
    const res = await request(app).delete('/portfolio-templates/1').set('Cookie', authCookie);
    expect(res.status).toBe(409);
  });

  test('403 without portfolio_template:manage_status', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).delete('/portfolio-templates/1').set('Cookie', authCookie);
    expect(res.status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe('GET /portfolio-templates/:id/bound-portfolios', () => {
  test('200 with the bound portfolio list', async () => {
    mockListBoundPortfolios.mockResolvedValue([{ id: 'p1', name: 'Charles-Schwab', ownerEmail: 'a@b.com', createdAt: '2026-08-06T00:00:00Z' }]);
    const res = await request(app).get('/portfolio-templates/1/bound-portfolios').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.portfolios).toHaveLength(1);
    expect(mockListBoundPortfolios).toHaveBeenCalledWith('1');
  });

  test('403 without portfolio_template:manage_status', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/portfolio-templates/1/bound-portfolios').set('Cookie', authCookie);
    expect(res.status).toBe(403);
    expect(mockListBoundPortfolios).not.toHaveBeenCalled();
  });
});

describe('DELETE /portfolio-templates/:id/bound-portfolios/:portfolioId', () => {
  test('200 on success', async () => {
    mockDeleteBoundPortfolio.mockResolvedValue(true);
    const res = await request(app).delete('/portfolio-templates/1/bound-portfolios/p1').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(mockDeleteBoundPortfolio).toHaveBeenCalledWith('1', 'p1');
  });

  test('404 when the portfolio is not bound to this template (or does not exist)', async () => {
    mockDeleteBoundPortfolio.mockResolvedValue(false);
    const res = await request(app).delete('/portfolio-templates/1/bound-portfolios/p1').set('Cookie', authCookie);
    expect(res.status).toBe(404);
  });

  test('403 without portfolio_template:manage_status', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).delete('/portfolio-templates/1/bound-portfolios/p1').set('Cookie', authCookie);
    expect(res.status).toBe(403);
    expect(mockDeleteBoundPortfolio).not.toHaveBeenCalled();
  });
});

describe('GET /portfolio-templates/unattached-portfolios', () => {
  test('200 with the unattached Flex portfolio list', async () => {
    mockListUnattached.mockResolvedValue([{ id: 'p1', name: 'Abandoned', ownerEmail: 'a@b.com', createdAt: '2026-08-28T00:00:00Z', holdingsCount: 3, cashAmount: 0 }]);
    const res = await request(app).get('/portfolio-templates/unattached-portfolios').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.portfolios).toHaveLength(1);
  });

  test('403 without portfolio_template:manage_status', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/portfolio-templates/unattached-portfolios').set('Cookie', authCookie);
    expect(res.status).toBe(403);
    expect(mockListUnattached).not.toHaveBeenCalled();
  });
});

describe('DELETE /portfolio-templates/unattached-portfolios/:portfolioId', () => {
  test('200 on success', async () => {
    mockDeleteUnattached.mockResolvedValue(true);
    const res = await request(app).delete('/portfolio-templates/unattached-portfolios/p1').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(mockDeleteUnattached).toHaveBeenCalledWith('p1');
  });

  test('404 when the portfolio is already resolved (or does not exist)', async () => {
    mockDeleteUnattached.mockResolvedValue(false);
    const res = await request(app).delete('/portfolio-templates/unattached-portfolios/p1').set('Cookie', authCookie);
    expect(res.status).toBe(404);
  });

  test('403 without portfolio_template:manage_status', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).delete('/portfolio-templates/unattached-portfolios/p1').set('Cookie', authCookie);
    expect(res.status).toBe(403);
    expect(mockDeleteUnattached).not.toHaveBeenCalled();
  });
});
