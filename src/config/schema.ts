import { z } from 'zod/v4';

export const upstreamConfigSchema = z.object({
  name: z.string().min(1).optional(),
  endpoint: z.string().url('Must be a valid URL'),
  api_key: z.string().min(1, 'API key is required'),
  upstream_model: z.string().min(1, 'Upstream model name is required'),
  format: z.enum(['anthropic', 'openai']),
  timeoutMs: z.coerce.number().int().positive().default(120000),
});

export const modelSlotSchema = z.object({
  model: z.string().min(1, 'Model name is required'),
  upstreams: z.array(upstreamConfigSchema).min(1, 'At least one upstream is required'),
});

export const sentimentSignalWeightsSchema = z.object({
  profanity: z.coerce.number().min(0).max(1).default(0.8),
  degradation: z.coerce.number().min(0).max(1).default(0.9),
  imperatives: z.coerce.number().min(0).max(1).default(0.4),
  caps: z.coerce.number().min(0).max(1).default(0.3),
  brevity: z.coerce.number().min(0).max(1).default(0.2),
  repetition: z.coerce.number().min(0).max(1).default(0.6),
  aiRefusal: z.coerce.number().min(0).max(1).default(0.7),
  aiHedging: z.coerce.number().min(0).max(1).default(0.3),
  aiApology: z.coerce.number().min(0).max(1).default(0.4),
  aiLengthDrop: z.coerce.number().min(0).max(1).default(0.5),
  aiLaziness: z.coerce.number().min(0).max(1).default(0.8),
  aiDisclaimer: z.coerce.number().min(0).max(1).default(0.3),
  aiSelfRepetition: z.coerce.number().min(0).max(1).default(0.5),
});

export const sentimentConfigSchema = z.object({
  threshold: z.coerce.number().min(0).max(1).default(0.6),
  decayRate: z.coerce.number().min(0).max(1).default(0.1),
  cooldownMs: z.coerce.number().int().min(0).default(300000),
  antiFlapMs: z.coerce.number().int().min(0).default(60000),
  weights: sentimentSignalWeightsSchema.optional(),
});

export const configSchema = z.object({
  _configPath: z.string().optional(),
  server: z.object({
    port: z.coerce.number().int().positive().default(3000),
    host: z.string().default('127.0.0.1'),
    api_key: z.string().min(1).optional(),
  }),
  sentiment: sentimentConfigSchema.optional(),
  model_slots: z.record(z.string(), modelSlotSchema).refine(
    (slots) => Object.keys(slots).length > 0,
    { message: 'At least one model slot is required' }
  ),
});

export type Config = z.infer<typeof configSchema>;
export type ModelSlotConfig = z.infer<typeof modelSlotSchema>;
export type UpstreamConfig = z.infer<typeof upstreamConfigSchema>;
export type SentimentConfig = z.infer<typeof sentimentConfigSchema>;
export type SentimentSignalWeights = z.infer<typeof sentimentSignalWeightsSchema>;
