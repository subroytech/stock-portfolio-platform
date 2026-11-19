import { listModelsForProvider, ProviderModelListError } from '../src/services/llmProviderModels.service';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('listModelsForProvider', () => {
  test('openai: calls the models endpoint with a Bearer header and returns sorted ids', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-5' }, { id: 'gpt-4o' }] }),
    });

    const result = await listModelsForProvider('openai', 'sk-openai-key');

    expect(result).toEqual(['gpt-4o', 'gpt-5']);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/models');
    expect(init.headers.Authorization).toBe('Bearer sk-openai-key');
  });

  test('anthropic: calls the models endpoint with x-api-key/anthropic-version headers and returns sorted ids', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'claude-sonnet-5' }, { id: 'claude-haiku-4-5' }] }),
    });

    const result = await listModelsForProvider('anthropic', 'sk-ant-key');

    expect(result).toEqual(['claude-haiku-4-5', 'claude-sonnet-5']);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/models');
    expect(init.headers['x-api-key']).toBe('sk-ant-key');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
  });

  test('throws ProviderModelListError, carrying the provider and status, on a non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });

    const error = await listModelsForProvider('openai', 'bad-key').catch((e) => e);

    expect(error).toBeInstanceOf(ProviderModelListError);
    expect(error).toMatchObject({ provider: 'openai', status: 401 });
  });

  test('the error message names the right provider', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });

    await expect(listModelsForProvider('anthropic', 'bad-key')).rejects.toThrow(/rejected by Anthropic/);
  });
});
