import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { Config } from '../../../../config/schema.js';
import { ConfigManager } from '../../../../config/manager.js';
import { switchRoutes } from '../switch.js';

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
      {
        fromIndex: 0,
        toIndex: 1,
        reason: 'threshold exceeded',
        score: 0.75,
        timestamp: Date.now() - 60000,
      },
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

describe('GET /api/dashboard/history', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    const configManager = new ConfigManager(MINIMAL_CONFIG, '');
    app = Fastify();
    await app.register(switchRoutes, { configManager, sentimentState: mockSentimentState });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with switch history', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard/history',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('returns slots keyed by slotId with switchHistory arrays', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard/history',
    });

    const body = JSON.parse(response.body);
    expect(body.slots).toHaveProperty('opus');
    expect(body.slots.opus.slotId).toBe('opus');
    expect(body.slots.opus.switchHistory).toBeInstanceOf(Array);
    expect(body.slots.opus.switchHistory).toHaveLength(1);
  });

  it('includes all switch event fields (fromIndex, toIndex, reason, score, timestamp)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard/history',
    });

    const body = JSON.parse(response.body);
    const event = body.slots.opus.switchHistory[0];
    expect(event).toHaveProperty('fromIndex', 0);
    expect(event).toHaveProperty('toIndex', 1);
    expect(event).toHaveProperty('reason', 'threshold exceeded');
    expect(event).toHaveProperty('score', 0.75);
    expect(event).toHaveProperty('timestamp');
    expect(typeof event.timestamp).toBe('number');
  });

  it('returns empty switchHistory for slots with no events', async () => {
    const emptySentimentState = {
      getAllSlots: () => {
        return {
          'empty-slot': {
            slotId: 'empty-slot',
            score: 0,
            lastUpdated: Date.now(),
            currentUpstreamIndex: 0,
            switchHistory: [],
            cooldownUntil: null,
            triggerCount: 0,
          },
        } as any;
      },
    } as any;

    const configManager = new ConfigManager(MINIMAL_CONFIG, '');
    const emptyApp = Fastify();
    await emptyApp.register(switchRoutes, { configManager, sentimentState: emptySentimentState });
    await emptyApp.ready();

    const response = await emptyApp.inject({
      method: 'GET',
      url: '/api/dashboard/history',
    });

    const body = JSON.parse(response.body);
    expect(body.slots['empty-slot'].switchHistory).toEqual([]);

    await emptyApp.close();
  });
});
