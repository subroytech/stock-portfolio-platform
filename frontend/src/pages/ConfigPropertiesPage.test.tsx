import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import ConfigPropertiesPage from './ConfigPropertiesPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConfigPropertiesPage />
    </QueryClientProvider>,
  );
}

const group = { id: '1', name: 'Data Retention Policies', description: null, createdAt: 't1', updatedAt: 't1' };
const property = {
  id: '1', groupId: '1', groupName: 'Data Retention Policies', propertyKey: 'contrarian_finder_admin_history_retention_count',
  name: 'Contrarian Finder Admin History Retention Count', description: null, valueType: 'integer',
  minValue: '1', maxValue: '500', status: 'active', currentValue: '60', currentVersion: 1, createdAt: 't1', updatedAt: 't1',
};

describe('ConfigPropertiesPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('lists groups (for the property-create picker) and properties, showing empty state when there are none', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/config-properties/groups') return Promise.resolve({ groups: [] });
      if (url === '/config-properties/properties') return Promise.resolve({ properties: [] });
      return Promise.resolve({});
    });
    renderPage();

    expect(await screen.findByText('No config properties have been created yet.')).toBeInTheDocument();
  });

  test('renders an existing property row with its current value and version', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/config-properties/groups') return Promise.resolve({ groups: [group] });
      if (url === '/config-properties/properties') return Promise.resolve({ properties: [property] });
      return Promise.resolve({});
    });
    renderPage();

    expect(await screen.findByText('Contrarian Finder Admin History Retention Count')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(screen.getByText(/version 1/)).toBeInTheDocument();
  });

  test('Create group POSTs the trimmed name/description', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/config-properties/groups' && options?.method === 'POST') {
        expect(JSON.parse(options.body as string)).toEqual({ name: 'Limits', description: null });
        return Promise.resolve({ group: { ...group, id: '2', name: 'Limits' } });
      }
      if (url === '/config-properties/groups') return Promise.resolve({ groups: [] });
      if (url === '/config-properties/properties') return Promise.resolve({ properties: [] });
      return Promise.resolve({});
    });
    renderPage();
    await screen.findByText('No config properties have been created yet.');

    await userEvent.type(screen.getByLabelText('Group name'), '  Limits  ');
    await userEvent.click(screen.getByRole('button', { name: 'Create group' }));

    expect(client.apiFetch).toHaveBeenCalledWith('/config-properties/groups', expect.objectContaining({ method: 'POST' }));
  });

  test('Create property POSTs the full definition including min/max for an integer type', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/config-properties/groups') return Promise.resolve({ groups: [group] });
      if (url === '/config-properties/properties' && options?.method === 'POST') {
        expect(JSON.parse(options.body as string)).toEqual({
          groupId: '1', propertyKey: 'max_portfolios_allowed', name: 'Max Portfolios Allowed', description: null,
          valueType: 'integer', minValue: '1', maxValue: '100', initialValue: '10',
        });
        return Promise.resolve({ property: { ...property, id: '2', propertyKey: 'max_portfolios_allowed' } });
      }
      if (url === '/config-properties/properties') return Promise.resolve({ properties: [] });
      return Promise.resolve({});
    });
    renderPage();
    await screen.findByText('No config properties have been created yet.');

    await userEvent.selectOptions(screen.getByLabelText('Group'), 'Data Retention Policies');
    await userEvent.type(screen.getByLabelText('property_key'), 'max_portfolios_allowed');
    await userEvent.type(screen.getByLabelText('Property name'), 'Max Portfolios Allowed');
    await userEvent.type(screen.getByLabelText('Min value'), '1');
    await userEvent.type(screen.getByLabelText('Max value'), '100');
    await userEvent.type(screen.getByLabelText('Initial value'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Create property' }));

    expect(client.apiFetch).toHaveBeenCalledWith('/config-properties/properties', expect.objectContaining({ method: 'POST' }));
  });

  test('min/max inputs are hidden when value type is string', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/config-properties/groups') return Promise.resolve({ groups: [group] });
      if (url === '/config-properties/properties') return Promise.resolve({ properties: [] });
      return Promise.resolve({});
    });
    renderPage();
    await screen.findByText('No config properties have been created yet.');

    expect(screen.getByLabelText('Min value')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Value type'), 'string');
    expect(screen.queryByLabelText('Min value')).not.toBeInTheDocument();
  });

  test('expanding a property row fetches and shows its value history', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/config-properties/groups') return Promise.resolve({ groups: [group] });
      if (url === '/config-properties/properties') return Promise.resolve({ properties: [property] });
      if (url === '/config-properties/properties/1/history') {
        return Promise.resolve({
          history: [
            { id: '1', propertyId: '1', value: '60', version: 1, effectiveTimestamp: 't1', isActive: true, changedBy: null, changedByEmail: null, createdAt: 't1' },
          ],
        });
      }
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('property-row-1'));
    expect(await screen.findByText('Value history')).toBeInTheDocument();
    expect(client.apiFetch).toHaveBeenCalledWith('/config-properties/properties/1/history');
  });

  test('Set new value PUTs the new value for the property', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/config-properties/groups') return Promise.resolve({ groups: [group] });
      if (url === '/config-properties/properties') return Promise.resolve({ properties: [property] });
      if (url === '/config-properties/properties/1/history') return Promise.resolve({ history: [] });
      if (url === '/config-properties/properties/1/value' && options?.method === 'PUT') {
        expect(JSON.parse(options.body as string)).toEqual({ value: '30' });
        return Promise.resolve({ value: { id: '2', propertyId: '1', value: '30', version: 2, effectiveTimestamp: 't2', isActive: true, changedBy: 'u1', changedByEmail: null, createdAt: 't2' } });
      }
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('property-row-1'));
    await screen.findByText('Value history');
    await userEvent.type(screen.getByLabelText(`New value for ${property.propertyKey}`), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Save value' }));

    expect(client.apiFetch).toHaveBeenCalledWith('/config-properties/properties/1/value', expect.objectContaining({ method: 'PUT' }));
  });

  test('a rejected out-of-range value surfaces the backend error message', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/config-properties/groups') return Promise.resolve({ groups: [group] });
      if (url === '/config-properties/properties') return Promise.resolve({ properties: [property] });
      if (url === '/config-properties/properties/1/history') return Promise.resolve({ history: [] });
      if (url === '/config-properties/properties/1/value' && options?.method === 'PUT') {
        throw new client.ApiError(400, '9999 is above the maximum allowed value of 500.', null);
      }
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('property-row-1'));
    await screen.findByText('Value history');
    await userEvent.type(screen.getByLabelText(`New value for ${property.propertyKey}`), '9999');
    await userEvent.click(screen.getByRole('button', { name: 'Save value' }));

    expect(await screen.findByText('9999 is above the maximum allowed value of 500.')).toBeInTheDocument();
  });
});
