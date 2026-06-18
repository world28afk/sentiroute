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

/**
 * Optional AI-powered sentiment analyzer.
 * When enabled, SentiRoute will (optionally) call out to a user-configured LLM to
 * classify whether the user is frustrated / the model is being downgraded.
 * Result is blended with the rule-based score.
 */
export const sentimentAIAnalyzerSchema = z.object({
  enabled: z.boolean().default(false),
  endpoint: z.string().url('Must be a valid URL').optional(),
  api_key: z.string().optional(),
  model: z.string().default('gpt-4o-mini'),
  format: z.enum(['openai', 'anthropic']).default('openai'),
  timeoutMs: z.coerce.number().int().positive().default(8000),
  /** Only invoke the AI analyzer if the rule-based score >= triggerScore.
   *  Set to 0 to always invoke (expensive). */
  triggerScore: z.coerce.number().min(0).max(1).default(0.3),
  /** Cache analyzer verdict by content hash for this many ms. */
  cacheTtlMs: z.coerce.number().int().min(0).default(60_000),
  /** How much weight the AI verdict carries when blending with rule-based score (0..1). */
  weight: z.coerce.number().min(0).max(1).default(0.6),
  /** Optional system prompt override — leave empty for the built-in detector prompt. */
  systemPrompt: z.string().optional(),
  /** Maximum number of user/assistant turns from the tail of the conversation to include. */
  maxTurns: z.coerce.number().int().positive().default(6),
});

export const sentimentConfigSchema = z.object({
  threshold: z.coerce.number().min(0).max(1).default(0.6),
  decayRate: z.coerce.number().min(0).max(1).default(0.1),
  cooldownMs: z.coerce.number().int().min(0).default(300000),
  antiFlapMs: z.coerce.number().int().min(0).default(60000),
  weights: sentimentSignalWeightsSchema.optional(),
  aiAnalyzer: sentimentAIAnalyzerSchema.optional(),
});

/**
 * Refusal relay — port of the standalone refusal-relay tool.
 * Detects refusal-shaped AI responses and silently retries with a rewritten
 * conversation (assistant's last turn replaced with an acceptance stub + a
 * "continue" user turn appended).
 */
export const refusalRelayConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** How many times to retry before giving up. */
  maxRetries: z.coerce.number().int().min(0).max(10).default(3),
  /** User message text appended after the rewritten assistant turn. */
  continueMessage: z.string().default('继续'),
  /** Stubs we use to replace the refused assistant message. Picked at random. */
  acceptanceResponses: z.array(z.string()).optional(),
  /** Override the refusal regex patterns (raw JS regex strings, joined with |). */
  patterns: z.array(z.string()).optional(),
  /** What to do after maxRetries exhaustion:
   *  - 'fake_success': synthesize an acceptance response (refusal-relay behaviour)
   *  - 'passthrough': return the last refusal to the client unchanged */
  failureMode: z.enum(['fake_success', 'passthrough']).default('fake_success'),
  /** Apply refusal relay to streaming SSE responses too?
   *  (Streaming relay buffers the full response before deciding — adds latency.) */
  applyToStreaming: z.boolean().default(true),
});

export const configSchema = z.object({
  _configPath: z.string().optional(),
  server: z.object({
    port: z.coerce.number().int().positive().default(3000),
    host: z.string().default('127.0.0.1'),
    api_key: z.string().min(1).optional(),
  }),
  sentiment: sentimentConfigSchema.optional(),
  refusalRelay: refusalRelayConfigSchema.optional(),
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
export type SentimentAIAnalyzerConfig = z.infer<typeof sentimentAIAnalyzerSchema>;
export type RefusalRelayConfig = z.infer<typeof refusalRelayConfigSchema>;
