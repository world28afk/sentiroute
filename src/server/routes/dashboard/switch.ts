import type { FastifyPluginAsync } from 'fastify';
import type { ConfigManager } from '../../../config/manager.js';
import type { SentimentState } from '../../../sentiment/state.js';

type ConfigOpts = { configManager: ConfigManager; sentimentState: SentimentState };

const switchRoutes: FastifyPluginAsync<ConfigOpts> = async (fastify, opts) => {
  fastify.get('/api/dashboard/history', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');

    // Get all slot states
    const slots = opts.sentimentState.getAllSlots();

    const slotHistory: Record<string, {
      slotId: string;
      switchHistory: Array<{
        fromIndex: number;
        toIndex: number;
        reason: string;
        score: number;
        timestamp: number;
      }>;
    }> = {};

    for (const [slotId, slotData] of Object.entries(slots)) {
      slotHistory[slotId] = {
        slotId: slotData.slotId,
        switchHistory: slotData.switchHistory.map((event) => ({
          fromIndex: event.fromIndex,
          toIndex: event.toIndex,
          reason: event.reason,
          score: event.score,
          timestamp: event.timestamp,
        })),
      };
    }

    return { slots: slotHistory };
  });
};

Object.defineProperty(switchRoutes, 'name', { value: 'dashboard-switch' });
export { switchRoutes };
