import type { FastifyPluginAsync } from 'fastify';
import type { ConfigManager } from '../../../config/manager.js';
import type { SentimentState } from '../../../sentiment/state.js';

type ConfigOpts = { configManager: ConfigManager; sentimentState: SentimentState };

const controlRoutes: FastifyPluginAsync<ConfigOpts> = async (fastify, opts) => {
  fastify.post('/api/dashboard/reset/:slotId', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');

    const { slotId } = request.params as { slotId: string };

    await opts.sentimentState.resetSlot(slotId);

    return {
      ok: true,
      slotId,
      message: `Sentiment state reset for ${slotId}`,
    };
  });
};

Object.defineProperty(controlRoutes, 'name', { value: 'dashboard-control' });
export { controlRoutes };
