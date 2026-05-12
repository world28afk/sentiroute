import type { FastifyPluginAsync } from 'fastify';
import type { ConfigManager } from '../../../config/manager.js';
import type { SentimentState } from '../../../sentiment/state.js';
import { configSchema } from '../../../config/schema.js';

type ConfigOpts = { configManager: ConfigManager; sentimentState: SentimentState };

const configRoutes: FastifyPluginAsync<ConfigOpts> = async (fastify, opts) => {
  // GET /api/dashboard/config — return sanitized config with masked API keys
  fastify.get('/api/dashboard/config', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return opts.configManager.getSanitizedConfig();
  });

  // PUT /api/dashboard/config — update config with Zod validation
  fastify.put('/api/dashboard/config', async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    // Merge body with existing config — allows partial updates from dashboard
    const merged = { ...opts.configManager.config, ...body } as Record<string, unknown>;

    // Validate merged config with Zod schema
    const result = configSchema.safeParse(merged);

    if (!result.success) {
      const issues = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return reply.code(400).send({
        error: 'Config validation failed',
        issues,
      });
    }

    // Replace config in memory
    opts.configManager.config = result.data;

    // Determine if a restart is recommended (structural change)
    const needsRestart = body.model_slots !== undefined;

    // Async write to disk — fire-and-forget via setImmediate
    setImmediate(async () => {
      try {
        await opts.configManager.persistToDisk();
      } catch (err) {
        fastify.log.error({ err }, 'Failed to write config');
      }
    });

    const message = needsRestart
      ? 'Config saved. Restart SentiRoute for structural changes to take effect.'
      : 'Runtime parameters updated.';

    return { ok: true, restartRecommended: needsRestart, message };
  });
};

Object.defineProperty(configRoutes, 'name', { value: 'dashboard-config' });
export { configRoutes };
