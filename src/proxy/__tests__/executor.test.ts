import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeUpstream } from '../executor.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const baseOpts = {
  url: 'https://api.anthropic.com/v1/messages',
  body: JSON.stringify({ model: 'claude-opus-4-7', messages: [], stream: false }),
  apiKey: 'sk-ant-test123',
  format: 'anthropic' as const,
  timeoutMs: 30000,
};

describe('executeUpstream', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns complete for non-streaming success response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '{"content":"hello"}',
    });

    const result = await executeUpstream(baseOpts);

    expect(result.kind).toBe('complete');
    if (result.kind === 'complete') {
      expect(result.body).toBe('{"content":"hello"}');
    }
  });

  it('returns streaming when stream:true in body', async () => {
    const stream = new ReadableStream();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: stream,
    });

    const streamingOpts = {
      ...baseOpts,
      body: JSON.stringify({ model: 'claude-opus-4-7', messages: [], stream: true }),
    };

    const result = await executeUpstream(streamingOpts);

    expect(result.kind).toBe('streaming');
    if (result.kind === 'streaming') {
      expect(result.stream).toBe(stream);
    }
  });

  it('passes through upstream 4xx error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => '{"error":{"type":"authentication_error","message":"invalid api key"}}',
    });

    const result = await executeUpstream(baseOpts);

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.statusCode).toBe(401);
      expect(result.body).toContain('authentication_error');
    }
  });

  it('passes through upstream 5xx error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => '{"error":{"type":"server_error","message":"internal"}}',
    });

    const result = await executeUpstream(baseOpts);

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.statusCode).toBe(500);
    }
  });

  it('returns 504 on timeout', async () => {
    mockFetch.mockImplementationOnce((_url, options) => {
      return new Promise((_resolve, reject) => {
        if (options.signal) {
          options.signal.addEventListener('abort', () => {
            reject(new Error('timeout'));
          }, { once: true });
        }
      });
    });

    const promise = executeUpstream(baseOpts);
    vi.advanceTimersByTime(30001);
    const result = await promise;

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.statusCode).toBe(504);
      const parsed = JSON.parse(result.body);
      expect(parsed.error.type).toBe('timeout_error');
    }
  });

  it('returns 502 on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

    const result = await executeUpstream(baseOpts);

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.statusCode).toBe(502);
      const parsed = JSON.parse(result.body);
      expect(parsed.error.type).toBe('upstream_error');
    }
  });

  it('sets Anthropic auth headers (x-api-key + anthropic-version)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '{}',
    });

    await executeUpstream(baseOpts);

    const fetchCall = mockFetch.mock.calls[0];
    const fetchHeaders = fetchCall[1].headers;
    expect(fetchHeaders['x-api-key']).toBe('sk-ant-test123');
    expect(fetchHeaders['anthropic-version']).toBe('2023-06-01');
    expect(fetchHeaders['Authorization']).toBeUndefined();
  });

  it('sets OpenAI auth header (Authorization: Bearer)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '{}',
    });

    const openaiOpts = { ...baseOpts, format: 'openai' as const, apiKey: 'sk-or-test789' };
    await executeUpstream(openaiOpts);

    const fetchCall = mockFetch.mock.calls[0];
    const fetchHeaders = fetchCall[1].headers;
    expect(fetchHeaders['Authorization']).toBe('Bearer sk-or-test789');
    expect(fetchHeaders['x-api-key']).toBeUndefined();
  });
});
