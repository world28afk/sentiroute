/**
 * Shared helpers for the proxy routes — refusal-relay execution,
 * SSE buffering, header / URL construction.
 *
 * Kept route-agnostic so /v1/messages and /v1/chat/completions can both call in.
 */

import type { FastifyRequest } from 'fastify';
import type { ResolvedSlot } from '../../proxy/router.js';
import type { Translator } from '../../translation/registry.js';
import { executeUpstream, type UpstreamResult } from '../../proxy/executor.js';
import { extractResponseText, extractStreamingText, hasToolUse, streamHasToolUse } from '../../refusal/extract.js';
import type { RefusalRelay } from '../../refusal/relay.js';

export function buildUpstreamUrl(endpoint: string, incomingUrl: string): string {
  const base = endpoint.replace(/\/+$/, '');
  const url = new URL(incomingUrl, 'http://localhost');
  const pathAndQuery = url.pathname + url.search;
  if (base.endsWith('/v1') && pathAndQuery.startsWith('/v1/')) {
    return base + pathAndQuery.slice(3);
  }
  return base + pathAndQuery;
}

export function passthroughHeaders(req: FastifyRequest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined) {
      out[k] = Array.isArray(v) ? v.join(', ') : v;
    }
  }
  return out;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Buffer the entire upstream stream into memory.
 * Returns the buffered SSE payload as a string.
 */
export async function bufferStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) buf += decoder.decode(value, { stream: true });
  }
  buf += decoder.decode();
  return buf;
}

export interface RelayContext {
  relay: RefusalRelay;
  /** The client's original request body (parsed JSON). */
  clientBody: Record<string, unknown>;
  /** Format the client speaks (used for retry-body shape + fake-success). */
  clientFormat: 'anthropic' | 'openai';
  /** The translator already chosen for client↔upstream conversion, or null for passthrough. */
  translator: Translator | null;
  /** Slot info for the upstream call. */
  slot: ResolvedSlot;
  /** URL to POST to. */
  url: string;
  /** Headers to forward. */
  headers: Record<string, string>;
}

export interface RelayOutcome {
  /** What the client should receive. */
  result: UpstreamResult;
  /** Diagnostic info to log. */
  retries: number;
  /** Whether refusal was detected anywhere in the chain. */
  refused: boolean;
  /** True if `result` is a synthesized fake-success body (no real upstream call backed it). */
  synthesized: boolean;
}

/**
 * Run the upstream call with refusal-relay retry logic for non-streaming responses.
 * Falls back to a single-shot execution if the relay is disabled.
 */
export async function executeWithRelayNonStream(ctx: RelayContext): Promise<RelayOutcome> {
  const { relay, slot, url, headers, clientBody, clientFormat, translator } = ctx;

  let currentClientBody: Record<string, unknown> = clientBody;
  let retries = 0;
  let refused = false;

  while (true) {
    const upstreamBody = translator
      ? JSON.stringify(translator.translateRequest(currentClientBody, slot.upstreamModel))
      : JSON.stringify({ ...currentClientBody, model: slot.upstreamModel });

    const result = await executeUpstream({
      url,
      body: upstreamBody,
      apiKey: slot.apiKey,
      format: slot.format,
      timeoutMs: slot.timeoutMs,
      headers,
    });

    if (!relay.enabled || result.kind !== 'complete') {
      return { result, retries, refused, synthesized: false };
    }

    // Parse the upstream response so we can detect refusal / tool calls.
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      return { result, retries, refused, synthesized: false };
    }

    if (hasToolUse(parsed)) {
      return { result, retries, refused, synthesized: false };
    }

    const text = extractResponseText(parsed);
    if (!relay.isRefusal(text)) {
      return { result, retries, refused, synthesized: false };
    }

    refused = true;
    if (retries >= relay.maxRetries) {
      // Exhausted retries — fall through to failure mode.
      if (relay.failureMode === 'passthrough') {
        return { result, retries, refused, synthesized: false };
      }
      const acceptance = relay.pickAcceptance();
      const synthBody = relay.buildFakeSuccessResponse(clientBody, acceptance, clientFormat);
      return {
        result: { kind: 'complete', body: JSON.stringify(synthBody) },
        retries,
        refused,
        synthesized: true,
      };
    }

    // Build the next retry: rewrite assistant turn + append "continue".
    retries += 1;
    const acceptance = relay.pickAcceptance();
    currentClientBody = relay.buildRetryRequest(currentClientBody, acceptance, clientFormat) as Record<string, unknown>;
  }
}

/**
 * Streaming variant — buffers the upstream stream, decides if it was a refusal,
 * retries if needed, returns the final stream as a string.
 *
 * Returns the buffered SSE payload + decision metadata.  Callers replay this
 * buffer to the client as if it were the original stream (one stream per call).
 *
 * Note: this DOES introduce latency vs. true streaming — the first byte to the
 * client only goes out after the upstream is fully buffered. That's the cost
 * of after-the-fact refusal detection.
 */
export interface RelayStreamOutcome {
  sseBuffer: string;
  retries: number;
  refused: boolean;
  synthesized: boolean;
  /** Populated only when an upstream call returned an error. */
  errorResult?: Extract<UpstreamResult, { kind: 'error' }>;
}

export async function executeWithRelayStream(ctx: RelayContext): Promise<RelayStreamOutcome> {
  const { relay, slot, url, headers, clientBody, clientFormat, translator } = ctx;

  let currentClientBody: Record<string, unknown> = clientBody;
  let retries = 0;
  let refused = false;

  while (true) {
    const upstreamBody = translator
      ? JSON.stringify(translator.translateRequest(currentClientBody, slot.upstreamModel))
      : JSON.stringify({ ...currentClientBody, model: slot.upstreamModel });

    const result = await executeUpstream({
      url,
      body: upstreamBody,
      apiKey: slot.apiKey,
      format: slot.format,
      timeoutMs: slot.timeoutMs,
      headers,
    });

    if (result.kind === 'error') {
      return { sseBuffer: '', retries, refused, synthesized: false, errorResult: result };
    }
    if (result.kind === 'complete') {
      // Shouldn't happen for stream=true, but if it does, treat as SSE-like passthrough.
      return { sseBuffer: result.body, retries, refused, synthesized: false };
    }

    // result.kind === 'streaming'

    // Buffer the entire stream so we can decide.
    const rawStream = translator
      ? translator.translateStream(result.stream as any, slot.upstreamModel)
      : (result.stream as any);
    const buffered = await bufferStream(rawStream as ReadableStream<Uint8Array>);

    if (streamHasToolUse(buffered)) {
      return { sseBuffer: buffered, retries, refused, synthesized: false };
    }

    const text = extractStreamingText(buffered);
    if (!relay.isRefusal(text)) {
      return { sseBuffer: buffered, retries, refused, synthesized: false };
    }

    refused = true;
    if (retries >= relay.maxRetries) {
      if (relay.failureMode === 'passthrough') {
        return { sseBuffer: buffered, retries, refused, synthesized: false };
      }
      const acceptance = relay.pickAcceptance();
      const fake = relay.buildFakeSuccessSse(clientBody, acceptance, clientFormat);
      return { sseBuffer: fake, retries, refused, synthesized: true };
    }

    retries += 1;
    const acceptance = relay.pickAcceptance();
    currentClientBody = relay.buildRetryRequest(currentClientBody, acceptance, clientFormat) as Record<string, unknown>;
  }
}
