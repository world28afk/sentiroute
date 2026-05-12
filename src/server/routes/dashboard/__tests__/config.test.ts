import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { Config } from '../../../../config/schema.js';
import { ConfigManager } from '../../../../config/manager.js';
import { configRoutes } from '../config.js';

const MINIMAL_CONFIG: Config = {
  server: { port: 3000, host: '127.0.0.1' },
  sentiment: {
    threshold: 0.6,
    decayRate: 0.1,
    cooldownMs: 300000,
    antiFlapMs: 60000,
  },
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

// Mock SentimentState that conforms to the interface used in ConfigOpts
const mockSentimentState = {
  getAllSlots: () => ({}),
  getSlot: (id: string) => ({
    slotId: id,
    score: 0,
    lastUpdated: Date.now(),
    currentUpstreamIndex: 0,
    switchHistory: [],
    cooldownUntil: null,
    triggerCount: 0,
  }),
  resetSlot: async () => {},
} as any;

describe('GET /api/dashboard/config', () => {
  let configManager: ConfigManager;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    configManager = new ConfigManager(MINIMAL_CONFIG, '');
    app = Fastify();
    await app.register(configRoutes, { configManager, sentimentState: mockSentimentState });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with masked API keys', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard/config',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');

    const body = JSON.parse(response.body);
    expect(body.model_slots['claude-opus-4.7'].upstreams[0].api_key).toBe('sk...345678');
    expect(body.server.port).toBe(3000);
  });

  it('does not expose raw API keys', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard/config',
    });

    const body = JSON.parse(response.body);
    const rawKey = body.model_slots['claude-opus-4.7'].upstreams[0].api_key;
    expect(rawKey).not.toBe('sk-test-key-12345678');
    expect(rawKey).toContain('...');
  });
});

describe('PUT /api/dashboard/config', () => {
  let configManager: ConfigManager;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    configManager = new ConfigManager(MINIMAL_CONFIG, '');
    app = Fastify();
    await app.register(configRoutes, { configManager, sentimentState: mockSentimentState });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('accepts valid config update and returns 200', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/dashboard/config',
      body: {
        sentiment: { threshold: 0.8 },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
    expect(body.restartRecommended).toBe(false);
    expect(body.message).toBe('Runtime parameters updated.');
  });

  it('returns restartRecommended=true when model_slots changes', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/dashboard/config',
      body: {
        model_slots: MINIMAL_CONFIG.model_slots,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
    expect(body.restartRecommended).toBe(true);
    expect(body.message).toContain('Restart SentiRoute');
  });

  it('updates the in-memory config', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/dashboard/config',
      body: {
        sentiment: { threshold: 0.75, decayRate: 0.2 },
      },
    });

    expect(configManager.config.sentiment?.threshold).toBe(0.75);
    expect(configManager.config.sentiment?.decayRate).toBe(0.2);
  });

  it('returns 400 on invalid config', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/dashboard/config',
      body: {
        server: { port: 'not-a-number' },
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Config validation failed');
    expect(body.issues).toBeInstanceOf(Array);
    expect(body.issues.length).toBeGreaterThan(0);
    expect(body.issues[0]).toHaveProperty('path');
    expect(body.issues[0]).toHaveProperty('message');
  });

  it('preserves existing config when merging partial updates', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/dashboard/config',
      body: {
        sentiment: { threshold: 0.9 },
      },
    });

    // Original model_slots should still be present
    expect(configManager.config.model_slots['claude-opus-4.7']).toBeDefined();
    expect(configManager.config.server.port).toBe(3000);
  });
});
