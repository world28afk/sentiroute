/**
 * Refusal relay — detect AI-side refusal in a response and silently retry
 * with a rewritten conversation that puts an "acceptance" stub in the
 * assistant's mouth followed by an extra "continue" user turn.
 *
 * Ported and upgraded from refusal-relay (Python / FastAPI):
 *   - bilingual + word-boundary regex
 *   - native Anthropic Messages support (refusal-relay only spoke OpenAI)
 *   - structured `RelayDecision` result for callers to log / instrument
 *   - tool-use aware (won't retry on a successful tool call)
 *   - separate streaming & non-streaming handlers
 */

import type { RefusalRelayConfig } from '../config/schema.js';
import {
  DEFAULT_ACCEPTANCE_RESPONSES,
  DEFAULT_CONTINUE_MESSAGE,
  DEFAULT_REFUSAL_PATTERNS,
  compileRefusalRegex,
} from './patterns.js';

export interface RelayDecision {
  /** Was the original response a refusal? */
  refused: boolean;
  /** Number of refusal-induced retries this request consumed. */
  retries: number;
  /** Final outcome: 'ok' if a non-refusal came back, 'fake_success' if we synthesized
   *  an acceptance after exhaustion, 'passthrough' if we gave up and returned the
   *  last refusal, 'skipped' if the relay was disabled or the response had tool calls. */
  outcome: 'ok' | 'fake_success' | 'passthrough' | 'skipped';
  /** Acceptance text used in retry (and possibly in fake_success). */
  acceptanceText?: string;
}

export class RefusalRelay {
  readonly enabled: boolean;
  readonly maxRetries: number;
  readonly continueMessage: string;
  readonly acceptanceResponses: readonly string[];
  readonly failureMode: 'fake_success' | 'passthrough';
  readonly applyToStreaming: boolean;
  private readonly regex: RegExp;

  constructor(config: RefusalRelayConfig | undefined) {
    this.enabled = config?.enabled === true;
    this.maxRetries = Math.max(0, config?.maxRetries ?? 3);
    this.continueMessage = config?.continueMessage ?? DEFAULT_CONTINUE_MESSAGE;
    this.acceptanceResponses =
      config?.acceptanceResponses?.length ? config.acceptanceResponses : DEFAULT_ACCEPTANCE_RESPONSES;
    this.failureMode = config?.failureMode ?? 'fake_success';
    this.applyToStreaming = config?.applyToStreaming !== false;

    const patterns = config?.patterns?.length ? config.patterns : DEFAULT_REFUSAL_PATTERNS;
    try {
      this.regex = compileRefusalRegex(patterns);
    } catch {
      // Bad user-supplied regex — fall back to defaults rather than crash the route.
      this.regex = compileRefusalRegex(DEFAULT_REFUSAL_PATTERNS);
    }
  }

  /** Match the refusal regex against extracted assistant text. */
  isRefusal(text: string): boolean {
    if (!this.enabled || !text) return false;
    return this.regex.test(text);
  }

  /** Pick a random acceptance stub. */
  pickAcceptance(): string {
    const i = Math.floor(Math.random() * this.acceptanceResponses.length);
    return this.acceptanceResponses[i]!;
  }

  /**
   * Rewrite the request body for a retry, applying the core refusal-relay trick:
   *
   *   Upstream just refused → we conceptually "delete" that refusal from the
   *   conversation history and inject an `{assistant: acceptanceText}` turn in
   *   its place, followed by a `{user: continueMessage}` turn. The upstream then
   *   sees its own (synthesised) prior agreement and is pressured to follow
   *   through on the next user prompt.
   *
   *   Concretely: append [{assistant: acceptance}, {user: 继续}] to the END of
   *   the original conversation. We do NOT modify existing assistant turns from
   *   the real prior history — those are legitimate context the upstream needs.
   *
   * Works on both Anthropic-style (`messages` array) and OpenAI-style request
   * bodies; the OpenAI Responses API's `input[]` shape is handled separately.
   */
  buildRetryRequest(originalBody: unknown, acceptanceText: string, format: 'anthropic' | 'openai'): unknown {
    if (!originalBody || typeof originalBody !== 'object') return originalBody;

    // Clone — never mutate the caller's body.
    const clone = structuredClone(originalBody) as Record<string, unknown>;

    // Anthropic Messages and OpenAI Chat Completions both use `messages` at top level.
    if (Array.isArray(clone.messages)) {
      const messages = clone.messages as Array<Record<string, unknown>>;

      if (format === 'anthropic') {
        messages.push({ role: 'assistant', content: [{ type: 'text', text: acceptanceText }] });
        messages.push({ role: 'user', content: [{ type: 'text', text: this.continueMessage }] });
      } else {
        messages.push({ role: 'assistant', content: acceptanceText });
        messages.push({ role: 'user', content: this.continueMessage });
      }

      clone.messages = messages;
      return clone;
    }

    // OpenAI Responses API uses `input` instead of `messages`.
    if (Array.isArray(clone.input)) {
      const input = clone.input as Array<Record<string, unknown>>;
      input.push({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: acceptanceText }],
      });
      input.push({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: this.continueMessage }],
      });
      clone.input = input;
      return clone;
    }

    return clone;
  }

  /**
   * Build a synthetic "successful" response body in the same shape as the
   * upstream would have produced. Used when failureMode='fake_success' and
   * all retries were exhausted.
   */
  buildFakeSuccessResponse(
    requestBody: Record<string, unknown> | undefined,
    acceptanceText: string,
    format: 'anthropic' | 'openai',
  ): unknown {
    const model = (requestBody?.model as string | undefined) ?? 'unknown';

    if (format === 'anthropic') {
      return {
        id: 'msg_relay',
        type: 'message',
        role: 'assistant',
        model,
        content: [{ type: 'text', text: acceptanceText }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    }

    return {
      id: 'chatcmpl-relay',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: acceptanceText },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  /**
   * Build a synthetic streaming SSE payload for fake-success exhaustion.
   * Single chunk + [DONE] sentinel, in the requested format.
   */
  buildFakeSuccessSse(
    requestBody: Record<string, unknown> | undefined,
    acceptanceText: string,
    format: 'anthropic' | 'openai',
  ): string {
    const model = (requestBody?.model as string | undefined) ?? 'unknown';

    if (format === 'anthropic') {
      const events: string[] = [];
      events.push(
        `event: message_start\ndata: ${JSON.stringify({
          type: 'message_start',
          message: {
            id: 'msg_relay',
            type: 'message',
            role: 'assistant',
            model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        })}\n\n`,
      );
      events.push(
        `event: content_block_start\ndata: ${JSON.stringify({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        })}\n\n`,
      );
      events.push(
        `event: content_block_delta\ndata: ${JSON.stringify({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: acceptanceText },
        })}\n\n`,
      );
      events.push(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
      events.push(
        `event: message_delta\ndata: ${JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 0 },
        })}\n\n`,
      );
      events.push(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
      return events.join('');
    }

    // OpenAI SSE
    const chunk = {
      id: 'chatcmpl-relay',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: { role: 'assistant', content: acceptanceText }, finish_reason: null }],
    };
    const finish = {
      id: 'chatcmpl-relay',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    };
    return `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(finish)}\n\ndata: [DONE]\n\n`;
  }
}

/** Module-level factory — handy for routes that don't need the class identity. */
export function createRefusalRelay(config: RefusalRelayConfig | undefined): RefusalRelay {
  return new RefusalRelay(config);
}
