jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/supportTicket.service', () => ({
  ...jest.requireActual('../src/services/supportTicket.service'),
  createTicket: jest.fn(),
  listTicketsForUser: jest.fn(),
  listAllTickets: jest.fn(),
  getSummaryCounts: jest.fn(),
  getTicketById: jest.fn(),
  getMessagesForTicket: jest.fn(),
  markOpenedByAdmin: jest.fn(),
  addMessage: jest.fn(),
}));
// This router's admin routes are real requests against the real /support router (mounted with
// rateLimiters in app.ts) - same no-op mock already used by other controller test files with
// enough requests to otherwise trip the real per-IP/per-user limiter.
jest.mock('../src/middleware/rateLimit', () => ({
  __esModule: true,
  default: [(_req: unknown, _res: unknown, next: () => void) => next(), (_req: unknown, _res: unknown, next: () => void) => next()],
}));

import request from 'supertest';
import { pool } from '../src/db/pool';
import * as supportTicketService from '../src/services/supportTicket.service';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockQuery = pool.query as unknown as jest.Mock;
const mockCreateTicket = supportTicketService.createTicket as jest.Mock;
const mockListTicketsForUser = supportTicketService.listTicketsForUser as jest.Mock;
const mockListAllTickets = supportTicketService.listAllTickets as jest.Mock;
const mockGetSummaryCounts = supportTicketService.getSummaryCounts as jest.Mock;
const mockGetTicketById = supportTicketService.getTicketById as jest.Mock;
const mockGetMessagesForTicket = supportTicketService.getMessagesForTicket as jest.Mock;
const mockMarkOpenedByAdmin = supportTicketService.markOpenedByAdmin as jest.Mock;
const mockAddMessage = supportTicketService.addMessage as jest.Mock;

const authCookie = `auth_token=${signToken('u1')}`;
const TICKET = { id: 't1', userId: 'u1', subject: 'Help', status: 'new', createdAt: 'x', updatedAt: 'x' };

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockReset();
  // support:manage permission checks default to "granted" - individual 403 tests override this
  // to an empty-rows response.
  mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
});

describe('POST /support/tickets', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).post('/support/tickets').send({ subject: 'Help', body: 'hi' });
    expect(res.status).toBe(401);
  });

  test('400 when subject or body is missing/blank', async () => {
    const res1 = await request(app).post('/support/tickets').set('Cookie', authCookie).send({ body: 'hi' });
    expect(res1.status).toBe(400);
    const res2 = await request(app).post('/support/tickets').set('Cookie', authCookie).send({ subject: '  ', body: 'hi' });
    expect(res2.status).toBe(400);
  });

  test('201 on success - reachable by ANY authenticated session, no permission required (the one channel a pending account has)', async () => {
    mockCreateTicket.mockResolvedValue(TICKET);
    const res = await request(app).post('/support/tickets').set('Cookie', authCookie).send({ subject: 'Help', body: 'I need help' });
    expect(res.status).toBe(201);
    expect(res.body.ticket).toEqual(TICKET);
    expect(mockCreateTicket).toHaveBeenCalledWith('u1', 'Help', 'I need help');
    // No pool.query at all for the permission check - this route has none.
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('GET /support/tickets/mine', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/support/tickets/mine');
    expect(res.status).toBe(401);
  });

  test('200 with only the caller\'s own tickets', async () => {
    mockListTicketsForUser.mockResolvedValue([TICKET]);
    const res = await request(app).get('/support/tickets/mine').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.tickets).toEqual([TICKET]);
    expect(mockListTicketsForUser).toHaveBeenCalledWith('u1');
  });
});

describe('GET /support/tickets/mine/:id', () => {
  test('404 when the ticket does not exist', async () => {
    mockGetTicketById.mockResolvedValue(null);
    const res = await request(app).get('/support/tickets/mine/t1').set('Cookie', authCookie);
    expect(res.status).toBe(404);
  });

  test('404 (not 403) when the ticket belongs to someone else', async () => {
    mockGetTicketById.mockResolvedValue({ ...TICKET, userId: 'someone-else' });
    const res = await request(app).get('/support/tickets/mine/t1').set('Cookie', authCookie);
    expect(res.status).toBe(404);
    expect(mockGetMessagesForTicket).not.toHaveBeenCalled();
  });

  test('200 with the thread for the caller\'s own ticket, no status side effect', async () => {
    mockGetTicketById.mockResolvedValue(TICKET);
    mockGetMessagesForTicket.mockResolvedValue([{ id: 'm1', ticketId: 't1', senderUserId: 'u1', body: 'hi', createdAt: 'x' }]);
    const res = await request(app).get('/support/tickets/mine/t1').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.ticket).toEqual(TICKET);
    expect(res.body.messages).toHaveLength(1);
    expect(mockMarkOpenedByAdmin).not.toHaveBeenCalled();
  });
});

describe('POST /support/tickets/mine/:id/messages', () => {
  test('400 when body is missing/blank', async () => {
    mockGetTicketById.mockResolvedValue(TICKET);
    const res = await request(app).post('/support/tickets/mine/t1/messages').set('Cookie', authCookie).send({ body: '  ' });
    expect(res.status).toBe(400);
  });

  test('404 when the ticket isn\'t the caller\'s own', async () => {
    mockGetTicketById.mockResolvedValue({ ...TICKET, userId: 'someone-else' });
    const res = await request(app).post('/support/tickets/mine/t1/messages').set('Cookie', authCookie).send({ body: 'more info' });
    expect(res.status).toBe(404);
  });

  test('201 on success, always reopens (isOwner: true)', async () => {
    mockGetTicketById.mockResolvedValue(TICKET);
    mockAddMessage.mockResolvedValue({ id: 'm2', ticketId: 't1', senderUserId: 'u1', body: 'more info', createdAt: 'x' });
    const res = await request(app).post('/support/tickets/mine/t1/messages').set('Cookie', authCookie).send({ body: 'more info' });
    expect(res.status).toBe(201);
    expect(mockAddMessage).toHaveBeenCalledWith('t1', 'u1', 'more info', { isOwner: true });
  });
});

describe('GET /support/tickets/summary', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/support/tickets/summary');
    expect(res.status).toBe(401);
  });

  test('403 for a signed-in user without support:manage', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/support/tickets/summary').set('Cookie', authCookie);
    expect(res.status).toBe(403);
    expect(mockGetSummaryCounts).not.toHaveBeenCalled();
  });

  test('200 with the per-status counts for a caller with support:manage', async () => {
    mockGetSummaryCounts.mockResolvedValue({ new: 2, open: 1, on_hold: 0, closed: 5 });
    const res = await request(app).get('/support/tickets/summary').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ new: 2, open: 1, on_hold: 0, closed: 5 });
  });
});

describe('GET /support/tickets', () => {
  test('403 without support:manage', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/support/tickets').set('Cookie', authCookie);
    expect(res.status).toBe(403);
  });

  test('400 for an invalid status filter', async () => {
    const res = await request(app).get('/support/tickets?status=bogus').set('Cookie', authCookie);
    expect(res.status).toBe(400);
  });

  test('200 with every ticket when no filter is given', async () => {
    mockListAllTickets.mockResolvedValue([TICKET]);
    const res = await request(app).get('/support/tickets').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(mockListAllTickets).toHaveBeenCalledWith(undefined);
  });

  test('200 filtered by a valid status', async () => {
    mockListAllTickets.mockResolvedValue([]);
    const res = await request(app).get('/support/tickets?status=on_hold').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(mockListAllTickets).toHaveBeenCalledWith('on_hold');
  });
});

describe('GET /support/tickets/:id (admin)', () => {
  test('403 without support:manage', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/support/tickets/t1').set('Cookie', authCookie);
    expect(res.status).toBe(403);
  });

  test('404 when the ticket does not exist', async () => {
    mockGetTicketById.mockResolvedValue(null);
    const res = await request(app).get('/support/tickets/t1').set('Cookie', authCookie);
    expect(res.status).toBe(404);
    expect(mockMarkOpenedByAdmin).not.toHaveBeenCalled();
  });

  test('200 and marks it opened - the read-receipt side effect', async () => {
    mockGetTicketById.mockResolvedValueOnce(TICKET).mockResolvedValueOnce({ ...TICKET, status: 'open' });
    mockGetMessagesForTicket.mockResolvedValue([]);
    const res = await request(app).get('/support/tickets/t1').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(mockMarkOpenedByAdmin).toHaveBeenCalledWith('t1');
    expect(res.body.ticket.status).toBe('open');
  });
});

describe('POST /support/tickets/:id/messages (admin)', () => {
  test('403 without support:manage', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/support/tickets/t1/messages').set('Cookie', authCookie).send({ body: 'reply', status: 'open' });
    expect(res.status).toBe(403);
  });

  test('400 for a missing/invalid status', async () => {
    const res1 = await request(app).post('/support/tickets/t1/messages').set('Cookie', authCookie).send({ body: 'reply' });
    expect(res1.status).toBe(400);
    const res2 = await request(app).post('/support/tickets/t1/messages').set('Cookie', authCookie).send({ body: 'reply', status: 'new' });
    expect(res2.status).toBe(400);
  });

  test('404 when the ticket does not exist', async () => {
    mockGetTicketById.mockResolvedValue(null);
    const res = await request(app).post('/support/tickets/t1/messages').set('Cookie', authCookie).send({ body: 'reply', status: 'closed' });
    expect(res.status).toBe(404);
  });

  test('201 on success, passes the admin-chosen status through as nextStatus', async () => {
    mockGetTicketById.mockResolvedValue(TICKET);
    mockAddMessage.mockResolvedValue({ id: 'm3', ticketId: 't1', senderUserId: 'u1', body: 'reply', createdAt: 'x' });
    const res = await request(app).post('/support/tickets/t1/messages').set('Cookie', authCookie).send({ body: 'reply', status: 'on_hold' });
    expect(res.status).toBe(201);
    expect(mockAddMessage).toHaveBeenCalledWith('t1', 'u1', 'reply', { isOwner: false, nextStatus: 'on_hold' });
  });
});
