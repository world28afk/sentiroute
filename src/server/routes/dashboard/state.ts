import type { FastifyPluginAsync } from 'fastify';
import type { ConfigManager } from '../../../config/manager.js';
import type { SentimentState } from '../../../sentiment/state.js';

type ConfigOpts = { configManager: ConfigManager; sentimentState: SentimentState };

const stateRoutes: FastifyPluginAsync<ConfigOpts> = async (fastify, opts) => {
  fastify.get('/api/dashboard/state', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');

    // Read sentiment config with defaults
    const sentimentCfg = opts.configManager.config.sentiment ?? {};
    const threshold = sentimentCfg.threshold ?? 0.6;
    const decayRate = sentimentCfg.decayRate ?? 0.1;
    const cooldownMs = sentimentCfg.cooldownMs ?? 300000;
    const antiFlapMs = sentimentCfg.antiFlapMs ?? 60000;

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
