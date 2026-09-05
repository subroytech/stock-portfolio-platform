jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
import { pool } from '../src/db/pool';
import {
  createTicket, listTicketsForUser, listAllTickets, getSummaryCounts, getTicketById,
  getMessagesForTicket, markOpenedByAdmin, addMessage, getNewTicketCount,
} from '../src/services/supportTicket.service';

const mockQuery = pool.query as unknown as jest.Mock;
const mockConnect = pool.connect as unknown as jest.Mock;

const TICKET_ROW = { id: 't1', user_id: 'u1', subject: 'Help', status: 'new', created_at: '2026-09-05T00:00:00Z', updated_at: '2026-09-05T00:00:00Z' };

describe('createTicket', () => {
  test('transactionally inserts the ticket then its first message, and returns the ticket', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [TICKET_ROW] }) // INSERT ticket
        .mockResolvedValueOnce({ rows: [] }) // INSERT message
        .mockResolvedValueOnce(undefined), // COMMIT
      release: jest.fn(),
    };
    mockConnect.mockReset();
    mockConnect.mockResolvedValue(client);

    const ticket = await createTicket('u1', 'Help', 'I need help');

    expect(ticket).toEqual({ id: 't1', userId: 'u1', subject: 'Help', status: 'new', createdAt: TICKET_ROW.created_at, updatedAt: TICKET_ROW.updated_at });
    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    const [ticketSql, ticketParams] = client.query.mock.calls[1];
    expect(ticketSql).toContain('INSERT INTO users_support_tickets');
    expect(ticketSql).toContain("'new'");
    expect(ticketParams).toEqual(['u1', 'Help']);
    const [msgSql, msgParams] = client.query.mock.calls[2];
    expect(msgSql).toContain('INSERT INTO users_support_ticket_messages');
    expect(msgParams).toEqual(['t1', 'u1', 'I need help']);
    expect(client.query).toHaveBeenNthCalledWith(4, 'COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back and releases the client if the transaction fails partway', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(new Error('db exploded')) // INSERT ticket fails
        .mockResolvedValueOnce(undefined), // ROLLBACK
      release: jest.fn(),
    };
    mockConnect.mockReset();
    mockConnect.mockResolvedValue(client);

    await expect(createTicket('u1', 'Help', 'body')).rejects.toThrow('db exploded');
    expect(client.query).toHaveBeenNthCalledWith(3, 'ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe('listTicketsForUser / listAllTickets', () => {
  test('listTicketsForUser filters by user_id and sorts newest-activity-first', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [TICKET_ROW] });
    const tickets = await listTicketsForUser('u1');
    expect(tickets).toEqual([{ id: 't1', userId: 'u1', subject: 'Help', status: 'new', createdAt: TICKET_ROW.created_at, updatedAt: TICKET_ROW.updated_at }]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('WHERE user_id = $1');
    expect(sql).toContain('ORDER BY updated_at DESC');
    expect(params).toEqual(['u1']);
  });

  test('listAllTickets with no status returns every ticket', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [TICKET_ROW] });
    await listAllTickets();
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('WHERE');
  });

  test('listAllTickets with a status filters by it', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listAllTickets('on_hold');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('WHERE status = $1');
    expect(params).toEqual(['on_hold']);
  });
});

describe('getSummaryCounts', () => {
  test('zero-fills any status with no rows', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'new', count: '3' }, { status: 'closed', count: '10' }] });
    const counts = await getSummaryCounts();
    expect(counts).toEqual({ new: 3, open: 0, on_hold: 0, closed: 10 });
  });
});

describe('getTicketById / getMessagesForTicket', () => {
  test('getTicketById returns null when no row matches', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getTicketById('nope')).toBeNull();
  });

  test('getMessagesForTicket orders oldest-first (chronological thread)', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'm1', ticket_id: 't1', sender_user_id: 'u1', body: 'hi', created_at: '2026-09-05T00:00:00Z' }] });
    const messages = await getMessagesForTicket('t1');
    expect(messages).toEqual([{ id: 'm1', ticketId: 't1', senderUserId: 'u1', body: 'hi', createdAt: '2026-09-05T00:00:00Z' }]);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('ORDER BY created_at ASC');
  });
});

describe('markOpenedByAdmin', () => {
  test('flips new -> open, no-op (WHERE status = \'new\') otherwise', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await markOpenedByAdmin('t1');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("SET status = 'open'");
    expect(sql).toContain("AND status = 'new'");
    expect(params).toEqual(['t1']);
  });
});

describe('addMessage', () => {
  function mockAddMessageTransaction() {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'm2', ticket_id: 't1', sender_user_id: 'u1', body: 'more info', created_at: '2026-09-05T01:00:00Z' }] })
        .mockResolvedValueOnce(undefined) // UPDATE
        .mockResolvedValueOnce(undefined), // COMMIT
      release: jest.fn(),
    };
    mockConnect.mockReset();
    mockConnect.mockResolvedValue(client);
    return client;
  }

  test('isOwner: true always reopens the ticket to \'new\', regardless of its prior status', async () => {
    const client = mockAddMessageTransaction();
    await addMessage('t1', 'u1', 'more info', { isOwner: true });
    const [updateSql, updateParams] = client.query.mock.calls[2];
    expect(updateSql).toContain('SET status = $2');
    expect(updateParams).toEqual(['t1', 'new']);
  });

  test('isOwner: false sets the admin-chosen nextStatus', async () => {
    const client = mockAddMessageTransaction();
    await addMessage('t1', 'admin-1', 'reply', { isOwner: false, nextStatus: 'on_hold' });
    const [, updateParams] = client.query.mock.calls[2];
    expect(updateParams).toEqual(['t1', 'on_hold']);
  });

  test('isOwner: false with no nextStatus defaults to \'open\'', async () => {
    const client = mockAddMessageTransaction();
    await addMessage('t1', 'admin-1', 'reply', { isOwner: false });
    const [, updateParams] = client.query.mock.calls[2];
    expect(updateParams).toEqual(['t1', 'open']);
  });

  test('isOwner: false rejects an invalid status before ever opening a transaction', async () => {
    mockConnect.mockReset();
    // 'new' is a valid TicketStatus at the type level (it's the reopen target for isOwner:
    // true) but not an admin-settable one - this is a runtime guard, not a type error.
    await expect(addMessage('t1', 'admin-1', 'reply', { isOwner: false, nextStatus: 'new' })).rejects.toThrow('Invalid status');
    expect(mockConnect).not.toHaveBeenCalled();
  });
});

describe('getNewTicketCount', () => {
  test('counts only \'new\' tickets', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '4' }] });
    expect(await getNewTicketCount()).toBe(4);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("WHERE status = 'new'");
  });
});
