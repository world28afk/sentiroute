import type { FastifyPluginAsync } from 'fastify';
import type { ConfigManager } from '../../../config/manager.js';
import type { SentimentState } from '../../../sentiment/state.js';
import type { SentimentConfig } from '../../../config/schema.js';

type ConfigOpts = { configManager: ConfigManager; sentimentState: SentimentState };

const DEFAULT_SENTIMENT: SentimentConfig = {
  threshold: 0.6,
  decayRate: 0.1,
  cooldownMs: 300000,
  antiFlapMs: 60000,
};

const stateRoutes: FastifyPluginAsync<ConfigOpts> = async (fastify, opts) => {
  fastify.get('/api/dashboard/state', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');

    // Read sentiment config with defaults
    const sentimentCfg = opts.configManager.config.sentiment ?? DEFAULT_SENTIMENT;
    const threshold = sentimentCfg.threshold;
    const decayRate = sentimentCfg.decayRate;
    const cooldownMs = sentimentCfg.cooldownMs;
    const antiFlapMs = sentimentCfg.antiFlapMs;

    // Get all slot states
    const slots = opts.sentimentState.getAllSlots();
    const now = Date.now();

    const slotStates: Record<string, {
      slotId: string;
      score: number;
      currentUpstreamIndex: number;
      cooldownUntil: number | null;
      triggerCount: number;
      lastUpdated: number;
    }> = {};

    for (const [slotId, slotData] of Object.entries(slots)) {
      slotStates[slotId] = {
        slotId: slotData.slotId,
        score: slotData.score,
        currentUpstreamIndex: slotData.currentUpstreamIndex,
        cooldownUntil: slotData.cooldownUntil,
        triggerCount: slotData.triggerCount,
        lastUpdated: slotData.lastUpdated,
      };
    }

    return {
      threshold,
      decayRate,
      cooldownMs,
      antiFlapMs,
      now,
      slots: slotStates,
    };
  });
};

Object.defineProperty(stateRoutes, 'name', { value: 'dashboard-state' });
export { stateRoutes };
