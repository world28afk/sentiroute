import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { Config } from '../../../../config/schema.js';
import { ConfigManager } from '../../../../config/manager.js';
import { stateRoutes } from '../state.js';

const MINIMAL_CONFIG: Config = {
  server: { port: 3000, host: '127.0.0.1' },
  sentiment: {
    threshold: 0.7,
    decayRate: 0.15,
    cooldownMs: 600000,
    antiFlapMs: 120000,
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

const mockSlotState: Record<string, {
  slotId: string;
  score: number;
  lastUpdated: number;
  currentUpstreamIndex: number;
  switchHistory: Array<Record<string, unknown>>;
  cooldownUntil: number | null;
  triggerCount: number;
}> = {
  'opus': {
    slotId: 'opus',
    score: 0.45,
    lastUpdated: Date.now() - 10000,
    currentUpstreamIndex: 1,
    switchHistory: [
      { fromIndex: 0, toIndex: 1, reason: 'threshold exceeded', score: 0.75, timestamp: Date.now() - 60000 },
    ],
    cooldownUntil: Date.now() + 300000,
    triggerCount: 2,
  },
};

const mockSentimentState = {
  getAllSlots: () => mockSlotState,
  getSlot: (id: string) => mockSlotState[id] ?? {
    slotId: id,
    score: 0,
    lastUpdated: Date.now(),
    currentUpstreamIndex: 0,
    switchHistory: [],
    cooldownUntil: null,
    triggerCount: 0,
  },
} as any;

describe('GET /api/dashboard/state', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    const configManager = new ConfigManager(MINIMAL_CONFIG, '');
    app = Fastify();
    await app.register(stateRoutes, { configManager, sentimentState: mockSentimentState });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with sentiment config fields', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard/state',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('threshold', 0.7);
    expect(body).toHaveProperty('decayRate', 0.15);
    expect(body).toHaveProperty('cooldownMs', 600000);
    expect(body).toHaveProperty('antiFlapMs', 120000);
    expect(body).toHaveProperty('now');
    expect(typeof body.now).toBe('number');
  });

  it('returns slots with sentiment state', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard/state',
    });

    const body = JSON.parse(response.body);
    expect(body.slots).toHaveProperty('opus');
    expect(body.slots.opus.slotId).toBe('opus');
    expect(body.slots.opus.score).toBe(0.45);
    expect(body.slots.opus.currentUpstreamIndex).toBe(1);
    expect(body.slots.opus.cooldownUntil).toBeGreaterThan(Date.now());
    expect(body.slots.opus.triggerCount).toBe(2);
  });

  it('does NOT include switchHistory in slot objects', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard/state',
    });

    const body = JSON.parse(response.body);
    expect(body.slots.opus).not.toHaveProperty('switchHistory');
  });

  it('handles empty slots gracefully', async () => {
    const emptySentimentState = {
      getAllSlots: () => ({}),
      getSlot: () => ({
        slotId: 'none',
        score: 0, lastUpdated: Date.now(),
        currentUpstreamIndex: 0, switchHistory: [],
        cooldownUntil: null, triggerCount: 0,
      }),
    } as any;

    const configManager = new ConfigManager(MINIMAL_CONFIG, '');
    const emptyApp = Fastify();
    await emptyApp.register(stateRoutes, { configManager, sentimentState: emptySentimentState });
    await emptyApp.ready();

    const response = await emptyApp.inject({
      method: 'GET',
      url: '/api/dashboard/state',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.slots).toEqual({});

    await emptyApp.close();
  });

  it('uses defaults when sentiment config is missing', async () => {
    const configNoSentiment: Config = {
      server: { port: 3000, host: '127.0.0.1' },
      model_slots: {
        'claude-opus-4.7': {
          model: 'claude-opus-4.7',
          upstreams: [
            {
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
    const configManager = new ConfigManager(configNoSentiment, '');
    const cmApp = Fastify();
    await cmApp.register(stateRoutes, { configManager, sentimentState: mockSentimentState });
    await cmApp.ready();

    const response = await cmApp.inject({
      method: 'GET',
      url: '/api/dashboard/state',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.threshold).toBe(0.6);
    expect(body.decayRate).toBe(0.1);
    expect(body.cooldownMs).toBe(300000);
    expect(body.antiFlapMs).toBe(60000);

    await cmApp.close();
  });
});
