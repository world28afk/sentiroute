import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../../config/schema.js';

const healthPlugin: FastifyPluginAsync<{ config: Config }> = async (fastify, opts) => {
  fastify.get('/health', async (_request, _reply) => {
    const uptimeSeconds = Math.floor(process.uptime());
    const modelSlots: Record<string, object> = {};

    for (const [slotId, slotConfig] of Object.entries(opts.config.model_slots)) {
      modelSlots[slotId] = {
        model: slotConfig.model,
        active_upstream_index: 0,
        upstreams: slotConfig.upstreams.map((u) => ({
          endpoint: u.endpoint,
          format: u.format,
        })),
      };
    }

    return {
      status: 'ok',
      version: '0.1.0',
      uptime_seconds: uptimeSeconds,
      config_file: opts.config._configPath ?? null,
      model_slots: modelSlots,
    };
  });
};

Object.defineProperty(healthPlugin, 'name', { value: 'health-route' });
export { healthPlugin as healthRoute };
