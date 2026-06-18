/**
 * Optional AI-powered sentiment analyzer.
 *
 * Why: rule-based keyword scoring catches loud frustration ("fuck this stupid model")
 * but misses sarcasm, exhaustion, polite-but-fed-up tone, and domain-specific
 * complaints ("the code you wrote doesn't even compile"). A small LLM can read the
 * conversation holistically and return a calibrated frustration score.
 *
 * Cost / latency strategy:
 *   - Disabled by default — user opts in by providing an endpoint and key.
 *   - Only invoked when the rule-based score >= triggerScore (gate against routine
 *     traffic).
 *   - Cached by content hash for cacheTtlMs to avoid double-charging on retries.
 *   - Fail-open: any analyzer error returns null, so the route falls back to
 *     rule-based scoring with zero impact.
 *   - Timeout-bounded — never blocks a proxy request beyond timeoutMs.
 *
 * The analyzer is called POST-RESPONSE in a fire-and-forget manner so it never
 * adds latency to the user's request. Its verdict feeds the sentiment state
 * for the NEXT request's switching decision.
 */

import type { SentimentAIAnalyzerConfig } from '../config/schema.js';

export interface AIAnalyzerVerdict {
  /** 0..1, higher = more frustrated user. */
  frustrationScore: number;
  /** 0..1, higher = stronger evidence the model is being downgraded. */
  degradationScore: number;
  /** Did the assistant refuse the user's request? */
  refusal: boolean;
  /** Short one-line reason from the model. Useful for logs. */
  reason: string;
  /** Was this verdict served from cache? */
  fromCache: boolean;
}

export const DEFAULT_SYSTEM_PROMPT = `You are a calibrated sentiment classifier for an AI proxy.

Given a recent slice of a developer's conversation with a coding assistant, decide:

1. frustrationScore (0.0 to 1.0): how frustrated, angry, or exhausted does the
   USER sound? 0 = polite/neutral, 0.5 = visibly annoyed, 1 = furious / cursing.
2. degradationScore (0.0 to 1.0): how strongly does the EVIDENCE suggest the
   ASSISTANT is being downgraded / lobotomized? Look for: refusals to do things
   it could clearly do before, lazy placeholder code, excessive disclaimers,
   repeated mistakes after correction, hedging instead of answering, dramatic
   drop in response quality. 0 = model is fine, 1 = clearly degraded.
3. refusal (boolean): did the most recent assistant message refuse the user's
   request (apologetic decline, policy-citation, "I cannot help with that")?
4. reason: ONE short English sentence (<= 20 words) explaining your verdict.

Respond ONLY with a single JSON object on one line, no preface, no markdown:
{"frustrationScore": 0.0, "degradationScore": 0.0, "refusal": false, "reason": "..."}`;

interface CacheEntry {
  verdict: AIAnalyzerVerdict;
  expiresAt: number;
}

export class AIAnalyzer {
  readonly config: SentimentAIAnalyzerConfig;
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<AIAnalyzerVerdict | null>>();

  constructor(config: SentimentAIAnalyzerConfig | undefined) {
    this.config = config ?? ({} as SentimentAIAnalyzerConfig);
  }

  /** True if the analyzer is configured + enabled. */
  get enabled(): boolean {
    return Boolean(this.config?.enabled && this.config?.endpoint && this.config?.api_key);
  }

  /**
   * Whether the analyzer should be invoked for this rule-based score.
   * Cheap pre-check so callers can avoid building a payload when disabled or below the gate.
   */
  shouldInvoke(ruleScore: number): boolean {
    if (!this.enabled) return false;
    return ruleScore >= (this.config.triggerScore ?? 0.3);
  }

  /**
   * Run the analyzer over a conversation slice. Returns null on disabled/error/timeout.
   * Deduplicates inflight requests for the same content hash.
   */
  async analyze(messages: Array<{ role: string; content: string }>): Promise<AIAnalyzerVerdict | null> {
    if (!this.enabled) return null;
    if (!messages.length) return null;

    const trimmed = this.trimMessages(messages);
    const key = this.hash(trimmed);

    // Cache hit
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.verdict, fromCache: true };
    }

    // Coalesce concurrent identical requests
    const existingInflight = this.inflight.get(key);
    if (existingInflight) return existingInflight;

    const p = this.callUpstream(trimmed)
      .then((verdict) => {
        if (verdict) {
          this.cache.set(key, {
            verdict,
            expiresAt: Date.now() + (this.config.cacheTtlMs ?? 60_000),
          });
          // Bound cache size
          if (this.cache.size > 200) this.evictOldest();
        }
        return verdict;
      })
      .catch(() => null)
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, p);
    return p;
  }

  /** Blend an AI verdict into a rule-based score. Returns the blended 0..1 value. */
  blend(ruleScore: number, verdict: AIAnalyzerVerdict | null): number {
    if (!verdict) return ruleScore;
    const weight = this.config.weight ?? 0.6;
    // The AI score = max of frustration and degradation — both are sufficient triggers.
    const aiScore = Math.max(verdict.frustrationScore, verdict.degradationScore);
    return Math.min(1, ruleScore * (1 - weight) + aiScore * weight);
  }

  private trimMessages(messages: Array<{ role: string; content: string }>): Array<{ role: string; content: string }> {
    const max = this.config.maxTurns ?? 6;
    return messages.slice(-max).map((m) => ({
      role: m.role,
      // Hard-cap each message to ~2000 chars so the analyzer cost stays predictable.
      content: m.content.length > 2000 ? m.content.slice(0, 1000) + '\n…\n' + m.content.slice(-1000) : m.content,
    }));
  }

  private hash(messages: Array<{ role: string; content: string }>): string {
    // Cheap non-crypto hash; we only need it as a cache key.
    let h = 0;
    const s = JSON.stringify(messages);
    for (let i = 0; i < s.length; i++) {
      h = (h << 5) - h + s.charCodeAt(i);
      h |= 0;
    }
    return h.toString(36);
  }

  private evictOldest(): void {
    const arr = [...this.cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const drop = Math.floor(arr.length / 4);
    for (let i = 0; i < drop; i++) this.cache.delete(arr[i]![0]);
  }

  private async callUpstream(messages: Array<{ role: string; content: string }>): Promise<AIAnalyzerVerdict | null> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error('analyzer-timeout')), this.config.timeoutMs ?? 8000);
    try {
      const systemPrompt = this.config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
      const convoBlock = messages.map((m) => `[${m.role}] ${m.content}`).join('\n\n');
      const userPrompt = `Recent conversation:\n\n${convoBlock}\n\nClassify per the schema.`;

      const text = await this.invokeFormat(systemPrompt, userPrompt, ctl.signal);
      if (!text) return null;
      return this.parseVerdict(text);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async invokeFormat(system: string, user: string, signal: AbortSignal): Promise<string | null> {
    const url = this.config.endpoint!.replace(/\/+$/, '');
    const model = this.config.model || 'gpt-4o-mini';

    if (this.config.format === 'anthropic') {
      const res = await fetch(`${url}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.config.api_key!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 200,
          temperature: 0,
          system,
          messages: [{ role: 'user', content: user }],
        }),
        signal,
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
      const block = j.content?.find((b) => b?.type === 'text');
      return block?.text ?? null;
    }

    // OpenAI Chat Completions
    const res = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.api_key}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
      }),
      signal,
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return j.choices?.[0]?.message?.content ?? null;
  }

  private parseVerdict(text: string): AIAnalyzerVerdict | null {
    // Be lenient about preamble / markdown — extract the first {...} block.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]) as {
        frustrationScore?: unknown;
        degradationScore?: unknown;
        refusal?: unknown;
        reason?: unknown;
      };
      const frust = clamp01(toNum(parsed.frustrationScore));
      const deg = clamp01(toNum(parsed.degradationScore));
      const refusal = Boolean(parsed.refusal);
      const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 200) : '';
      return {
        frustrationScore: frust,
        degradationScore: deg,
        refusal,
        reason,
        fromCache: false,
      };
    } catch {
      return null;
    }
  }
}

function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function createAIAnalyzer(config: SentimentAIAnalyzerConfig | undefined): AIAnalyzer {
  return new AIAnalyzer(config);
}
