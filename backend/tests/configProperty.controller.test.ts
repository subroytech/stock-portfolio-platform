jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/configProperty.service', () => ({
  ...jest.requireActual('../src/services/configProperty.service'),
  listGroups: jest.fn(),
  createGroup: jest.fn(),
  updateGroup: jest.fn(),
  listProperties: jest.fn(),
  createProperty: jest.fn(),
  updatePropertyMetadata: jest.fn(),
  setPropertyValue: jest.fn(),
  listPropertyValueHistory: jest.fn(),
}));

import request from 'supertest';
import { pool } from '../src/db/pool';
import * as configPropertyService from '../src/services/configProperty.service';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockQuery = pool.query as unknown as jest.Mock;
const mockListGroups = configPropertyService.listGroups as jest.Mock;
const mockCreateGroup = configPropertyService.createGroup as jest.Mock;
const mockUpdateGroup = configPropertyService.updateGroup as jest.Mock;
const mockListProperties = configPropertyService.listProperties as jest.Mock;
const mockCreateProperty = configPropertyService.createProperty as jest.Mock;
const mockUpdatePropertyMetadata = configPropertyService.updatePropertyMetadata as jest.Mock;
const mockSetPropertyValue = configPropertyService.setPropertyValue as jest.Mock;
const mockListHistory = configPropertyService.listPropertyValueHistory as jest.Mock;

const authCookie = `auth_token=${signToken('user-1')}`;

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] }); // requirePermission gate defaults to passing
  mockListGroups.mockReset();
  mockCreateGroup.mockReset();
  mockUpdateGroup.mockReset();
  mockListProperties.mockReset();
  mockCreateProperty.mockReset();
  mockUpdatePropertyMetadata.mockReset();
  mockSetPropertyValue.mockReset();
  mockListHistory.mockReset();
});

describe('GET /config-properties/groups', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/config-properties/groups');
    expect(res.status).toBe(401);
  });

  test('403 without config_properties:manage', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/config-properties/groups').set('Cookie', authCookie);
    expect(res.status).toBe(403);
    expect(mockListGroups).not.toHaveBeenCalled();
  });

  test('200 with the group list', async () => {
    mockListGroups.mockResolvedValue([{ id: '1', name: 'Data Retention Policies', description: null, createdAt: 'x', updatedAt: 'x' }]);
    const res = await request(app).get('/config-properties/groups').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(1);
  });
});

describe('POST /config-properties/groups', () => {
  test('400 when name is missing', async () => {
    const res = await request(app).post('/config-properties/groups').set('Cookie', authCookie).send({});
    expect(res.status).toBe(400);
    expect(mockCreateGroup).not.toHaveBeenCalled();
  });

  test('201 on success', async () => {
    mockCreateGroup.mockResolvedValue({ id: '1', name: 'Limits', description: null, createdAt: 'x', updatedAt: 'x' });
    const res = await request(app).post('/config-properties/groups').set('Cookie', authCookie).send({ name: 'Limits' });
    expect(res.status).toBe(201);
    expect(mockCreateGroup).toHaveBeenCalledWith({ name: 'Limits', description: null });
  });

  test('409 on a duplicate group name', async () => {
    mockCreateGroup.mockRejectedValue(new configPropertyService.DuplicateConfigGroupError('exists'));
    const res = await request(app).post('/config-properties/groups').set('Cookie', authCookie).send({ name: 'Limits' });
    expect(res.status).toBe(409);
  });
});

describe('PUT /config-properties/groups/:id', () => {
  test('400 when name is missing', async () => {
    const res = await request(app).put('/config-properties/groups/1').set('Cookie', authCookie).send({});
    expect(res.status).toBe(400);
  });

  test('404 when the group does not exist', async () => {
    mockUpdateGroup.mockResolvedValue(null);
    const res = await request(app).put('/config-properties/groups/999').set('Cookie', authCookie).send({ name: 'Limits' });
    expect(res.status).toBe(404);
  });

  test('200 on success', async () => {
    mockUpdateGroup.mockResolvedValue({ id: '1', name: 'Limits', description: null, createdAt: 'x', updatedAt: 'x' });
    const res = await request(app).put('/config-properties/groups/1').set('Cookie', authCookie).send({ name: 'Limits' });
    expect(res.status).toBe(200);
  });
});

describe('GET /config-properties/properties', () => {
  test('200, passing along groupId when provided', async () => {
    mockListProperties.mockResolvedValue([]);
    await request(app).get('/config-properties/properties?groupId=1').set('Cookie', authCookie);
    expect(mockListProperties).toHaveBeenCalledWith({ groupId: '1' });
  });

  test('omits groupId when not provided', async () => {
    mockListProperties.mockResolvedValue([]);
    await request(app).get('/config-properties/properties').set('Cookie', authCookie);
    expect(mockListProperties).toHaveBeenCalledWith({ groupId: undefined });
  });
});

describe('POST /config-properties/properties', () => {
  const validBody = {
    groupId: '1',
    propertyKey: 'max_portfolios_allowed',
    name: 'Max Portfolios Allowed',
    valueType: 'integer',
    initialValue: '10',
  };

  test('400 when a required field is missing', async () => {
    const res = await request(app).post('/config-properties/properties').set('Cookie', authCookie).send({ groupId: '1' });
    expect(res.status).toBe(400);
    expect(mockCreateProperty).not.toHaveBeenCalled();
  });

  test('201 on success, saved under the caller\'s own user id', async () => {
    mockCreateProperty.mockResolvedValue({ id: '1', propertyKey: 'max_portfolios_allowed' });
    const res = await request(app).post('/config-properties/properties').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(201);
    expect(mockCreateProperty).toHaveBeenCalledWith({
      groupId: '1',
      propertyKey: 'max_portfolios_allowed',
      name: 'Max Portfolios Allowed',
      description: null,
      valueType: 'integer',
      minValue: null,
      maxValue: null,
      status: 'active',
      initialValue: '10',
      changedBy: 'user-1',
    });
  });

  test('400 when the service rejects an invalid value/type', async () => {
    mockCreateProperty.mockRejectedValue(new configPropertyService.InvalidConfigValueError('bad value'));
    const res = await request(app).post('/config-properties/properties').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(400);
  });

  test('409 on a duplicate property key', async () => {
    mockCreateProperty.mockRejectedValue(new configPropertyService.DuplicatePropertyKeyError('exists'));
    const res = await request(app).post('/config-properties/properties').set('Cookie', authCookie).send(validBody);
    expect(res.status).toBe(409);
  });
});

describe('PUT /config-properties/properties/:id', () => {
  test('400 when name is missing', async () => {
    const res = await request(app).put('/config-properties/properties/1').set('Cookie', authCookie).send({});
    expect(res.status).toBe(400);
  });

  test('404 when the property does not exist', async () => {
    mockUpdatePropertyMetadata.mockResolvedValue(null);
    const res = await request(app).put('/config-properties/properties/999').set('Cookie', authCookie).send({ name: 'Renamed' });
    expect(res.status).toBe(404);
  });

  test('200 on success', async () => {
    mockUpdatePropertyMetadata.mockResolvedValue({ id: '1', name: 'Renamed' });
    const res = await request(app).put('/config-properties/properties/1').set('Cookie', authCookie).send({ name: 'Renamed' });
    expect(res.status).toBe(200);
  });
});

describe('PUT /config-properties/properties/:id/value', () => {
  test('400 when value is missing', async () => {
    const res = await request(app).put('/config-properties/properties/1/value').set('Cookie', authCookie).send({});
    expect(res.status).toBe(400);
    expect(mockSetPropertyValue).not.toHaveBeenCalled();
  });

  test('404 when the property does not exist', async () => {
    mockSetPropertyValue.mockResolvedValue(null);
    const res = await request(app).put('/config-properties/properties/999/value').set('Cookie', authCookie).send({ value: '30' });
    expect(res.status).toBe(404);
  });

  test('400 when the value fails validation (e.g. out of range)', async () => {
    mockSetPropertyValue.mockRejectedValue(new configPropertyService.InvalidConfigValueError('out of range'));
    const res = await request(app).put('/config-properties/properties/1/value').set('Cookie', authCookie).send({ value: '9999' });
    expect(res.status).toBe(400);
  });

  test('200 on success, saved under the caller\'s own user id', async () => {
    mockSetPropertyValue.mockResolvedValue({ id: '2', propertyId: '1', value: '30', version: 2 });
    const res = await request(app).put('/config-properties/properties/1/value').set('Cookie', authCookie).send({ value: '30' });
    expect(res.status).toBe(200);
    expect(mockSetPropertyValue).toHaveBeenCalledWith('1', { value: '30', changedBy: 'user-1' });
  });
});

describe('GET /config-properties/properties/:id/history', () => {
  test('200 with the value history', async () => {
    mockListHistory.mockResolvedValue([{ id: '1', version: 1 }]);
    const res = await request(app).get('/config-properties/properties/1/history').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(1);
  });
});
