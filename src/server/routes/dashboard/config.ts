import type { FastifyPluginAsync } from 'fastify';
import type { ConfigManager } from '../../../config/manager.js';
import type { SentimentConfig } from '../../../config/schema.js';
import { configSchema } from '../../../config/schema.js';
import type { SentimentState } from '../../../sentiment/state.js';

type ConfigOpts = { configManager: ConfigManager; sentimentState: SentimentState };

/** Detect masked API keys: "sk...Fjrjs" or "***" */
function isMaskedKey(s: string): boolean {
  return s === '***' || /^[^.]{2,}\.\.\..{2,}$/.test(s);
}

/** Merge incoming model_slots with existing, preserving real api_keys */
function preserveMaskedKeys(
  incoming: Record<string, { upstreams: { api_key: string }[] }>,
  existing: Record<string, { upstreams: { api_key: string }[] }>,
): void {
  for (const [slotId, slot] of Object.entries(incoming)) {
    const orig = existing[slotId];
    if (!orig) continue;
    for (let i = 0; i < slot.upstreams.length; i++) {
      if (slot.upstreams[i] && orig.upstreams[i] && isMaskedKey(slot.upstreams[i].api_key)) {
        slot.upstreams[i].api_key = orig.upstreams[i].api_key;
      }
    }
  }
}

const configRoutes: FastifyPluginAsync<ConfigOpts> = async (fastify, opts) => {
  // GET /api/dashboard/config — return sanitized config with masked API keys
  // Pass ?reveal_keys=true to get raw keys (for editing in the dashboard)
  fastify.get('/api/dashboard/config', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const reveal = (request.query as Record<string, string>).reveal_keys === 'true';
    if (reveal) {
      return structuredClone(opts.configManager.config);
    }
    return opts.configManager.getSanitizedConfig();
  });

  // PUT /api/dashboard/config — update config
  fastify.put('/api/dashboard/config', async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    // Always validate the full merged config with Zod
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

    // Detect if this is a structural change (model_slots) or runtime-only
    const isStructural = body.model_slots !== undefined;

    if (isStructural) {
      // Preserve real api_keys — the frontend sends masked keys for untouched upstreams
      const incoming = result.data.model_slots as Record<string, { upstreams: { api_key: string }[] }>;
      const existing = opts.configManager.config.model_slots as Record<string, { upstreams: { api_key: string }[] }>;
      preserveMaskedKeys(incoming, existing);

      // Full config update: replace in memory (breaks proxy route reference — restart needed)
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
