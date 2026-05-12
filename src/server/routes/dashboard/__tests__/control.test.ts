import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { Config } from '../../../../config/schema.js';
import { ConfigManager } from '../../../../config/manager.js';
import { controlRoutes } from '../control.js';

const MINIMAL_CONFIG: Config = {
  server: { port: 3000, host: '127.0.0.1' },
  model_slots: {
    'claude-opus-4.7': {
      model: 'claude-opus-4.7',
      upstreams: [
        {
          name: 'primary',
          endpoint: 'https://api.example.com/v1',
          api_key: 'sk-test-key-12345678',
          upstream_model: 'claude-opus-4.7',
          format: 'anthropic',
          timeoutMs: 120000,
        },
      ],
    },
  },
};

describe('POST /api/dashboard/reset/:slotId', () => {
  let app: ReturnType<typeof Fastify>;
  let resetSlotMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    resetSlotMock = vi.fn().mockResolvedValue(undefined);

    const mockSentimentState = {
      resetSlot: resetSlotMock,
    } as any;

    const configManager = new ConfigManager(MINIMAL_CONFIG, '');
    app = Fastify();
    await app.register(controlRoutes, { configManager, sentimentState: mockSentimentState });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 and calls resetSlot with slotId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/dashboard/reset/claude-opus-4.7',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');

    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
    expect(body.slotId).toBe('claude-opus-4.7');
    expect(body.message).toContain('claude-opus-4.7');

    expect(resetSlotMock).toHaveBeenCalledWith('claude-opus-4.7');
  });

  it('handles slotIds with dots and special characters', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/dashboard/reset/claude-sonnet-4.6',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.slotId).toBe('claude-sonnet-4.6');
    expect(resetSlotMock).toHaveBeenCalledWith('claude-sonnet-4.6');
  });
});
