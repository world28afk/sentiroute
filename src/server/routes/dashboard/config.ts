import type { FastifyPluginAsync } from 'fastify';
import type { ConfigManager } from '../../../config/manager.js';
import type { SentimentConfig } from '../../../config/schema.js';
import { configSchema } from '../../../config/schema.js';
import type { SentimentState } from '../../../sentiment/state.js';

type ConfigOpts = { configManager: ConfigManager; sentimentState: SentimentState };

const configRoutes: FastifyPluginAsync<ConfigOpts> = async (fastify, opts) => {
  // GET /api/dashboard/config — return sanitized config with masked API keys
  fastify.get('/api/dashboard/config', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return opts.configManager.getSanitizedConfig();
  });

  // PUT /api/dashboard/config — update config
  fastify.put('/api/dashboard/config', async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    // Detect if this is a structural change (model_slots) or runtime-only
    const isStructural = body.model_slots !== undefined;

    if (isStructural) {
      // Full config update: merge, validate, replace
      const merged = { ...opts.configManager.config, ...body } as Record<string, unknown>;

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

      // Replace config in memory (breaks proxy route reference — restart needed)
      opts.configManager.config = result.data;

      // Async write to disk — fire-and-forget via setImmediate
      setImmediate(async () => {
        try {
          await opts.configManager.persistToDisk();
        } catch (err) {
          fastify.log.error({ err }, 'Failed to write config');
        }
      });

      return {
        ok: true,
        restartRecommended: true,
        message: 'Config saved. Restart SentiRoute for structural changes to take effect.',
      };
    }

    // Runtime parameters only — hot-update sentiment in-place
    // This preserves the object reference so proxy routes see the new values
    if (body.sentiment) {
      const s = body.sentiment as Record<string, unknown>;

      const update: Partial<SentimentConfig> = {};
      if (s.threshold !== undefined) update.threshold = Number(s.threshold);
      if (s.decayRate !== undefined) update.decayRate = Number(s.decayRate);
      if (s.cooldownMs !== undefined) update.cooldownMs = Number(s.cooldownMs);
      if (s.antiFlapMs !== undefined) update.antiFlapMs = Number(s.antiFlapMs);
      if (Object.keys(update).length > 0) {
        opts.configManager.updateSentiment(update);
      }

      if (s.weights && typeof s.weights === 'object') {
        opts.configManager.updateWeights(s.weights as Record<string, number>);
      }
    }

    return {
      ok: true,
      restartRecommended: false,
      message: 'Runtime parameters updated.',
    };
  });
};

Object.defineProperty(configRoutes, 'name', { value: 'dashboard-config' });
export { configRoutes };
