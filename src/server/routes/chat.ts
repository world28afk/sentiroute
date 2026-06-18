import type { FastifyPluginAsync } from 'fastify';
import { Readable } from 'node:stream';
import type { Config, SentimentConfig } from '../../config/schema.js';
import { resolveSlot } from '../../proxy/router.js';
import { getRequestLogger } from '../middleware/logging.js';
import { getTranslator } from '../../translation/registry.js';
import { SentimentState } from '../../sentiment/state.js';
import { analyzeSentiment, extractUserMessages, analyzeAIResponse, DEFAULT_WEIGHTS } from '../../sentiment/signals.js';
import { applySentimentSwitch } from '../../sentiment/switch.js';
import { extractResponseText } from '../../refusal/extract.js';
import { createRefusalRelay } from '../../refusal/relay.js';
import {
  buildUpstreamUrl,
  executeWithRelayNonStream,
  executeWithRelayStream,
  nowIso,
  passthroughHeaders,
} from './helpers.js';

type RouteOpts = { config: Config; dataDir: string; sentimentState: SentimentState };

const chatPlugin: FastifyPluginAsync<RouteOpts> = async (fastify, opts) => {
  const fileLog = getRequestLogger(opts.dataDir);

  fastify.post('/v1/chat/completions', async (request, reply) => {
    const start = Date.now();
    const body = request.body as Record<string, unknown>;
    const modelId = body.model as string;
    const isStream = body.stream === true;

    let slot;
    try {
      slot = resolveSlot(opts.config, modelId);
    } catch {
      const msg = `${nowIso()}  POST /v1/chat/completions  ${modelId}  ?  -`;
      console.log(msg);
      return reply.code(400).send({
        error: { type: 'invalid_request_error', message: `Unknown model: ${modelId}` },
      });
    }

    // ── Sentiment analysis ──
    const sentimentCfg: SentimentConfig = opts.config.sentiment ?? {
      threshold: 0.6, decayRate: 0.1, cooldownMs: 300000, antiFlapMs: 60000,
    };
    const weights = sentimentCfg.weights ?? DEFAULT_WEIGHTS;
    const messages = (body.messages as Array<{ role: string; content: string | unknown }>) ?? [];
    const userMessages = extractUserMessages(messages);
    const analysis = analyzeSentiment(userMessages, weights);

    const slotState = await opts.sentimentState.updateScore(slot.slotId, analysis.score, sentimentCfg);

    // ── Auto-switch check ──
    const switchResult = await applySentimentSwitch(
      opts.sentimentState,
      slot.slotId,
      sentimentCfg,
      slot.totalUpstreams,
    );

    if (switchResult.switched) {
      slot = resolveSlot(opts.config, modelId, switchResult.upstreamIndex);
      console.log(`${nowIso()}  SWITCH  ${slot.slotId}  ${switchResult.reason}`);
    }

    const translator = getTranslator('openai', slot.format);
    const url = buildUpstreamUrl(slot.endpoint, request.raw.url ?? '/v1/chat/completions');
    const headers = passthroughHeaders(request);

    // ── Refusal relay ──
    const relay = createRefusalRelay(opts.config.refusalRelay);
    const useRelayForStream = relay.enabled && relay.applyToStreaming;

    const relayCtx = {
      relay,
      clientBody: body,
      clientFormat: 'openai' as const,
      translator,
      slot,
      url,
      headers,
    };

    // ── Non-streaming path ──
    if (!isStream) {
      const outcome = await executeWithRelayNonStream(relayCtx);
      const latencyMs = Date.now() - start;
      const status = outcome.result.kind === 'error' ? outcome.result.statusCode : 200;
      const relayTag = outcome.refused ? `  RELAY(${outcome.retries}${outcome.synthesized ? '+fake' : ''})` : '';
      console.log(
        `${nowIso()}  POST /v1/chat/completions  ${slot.slotId}  ${slot.upstreamName}  ${status}  ${latencyMs}ms${relayTag}`,
      );

      fileLog.info({
        path: '/v1/chat/completions',
        model: slot.slotId,
        upstream: slot.upstreamName,
        status,
        latency: latencyMs,
        stream: false,
        sentimentScore: slotState.score,
        relayRefused: outcome.refused,
        relayRetries: outcome.retries,
        relaySynthesized: outcome.synthesized,
      });

      if (outcome.result.kind === 'error') {
        reply.code(outcome.result.statusCode).type('application/json').send(outcome.result.body);
        return;
      }
      if (outcome.result.kind === 'streaming') {
        reply.code(502).type('application/json').send({ error: 'Unexpected upstream streaming response' });
        return;
      }

      const completeBody = outcome.result.body;

      const responseBodyStr =
        translator && !outcome.synthesized
          ? translator.translateResponse(completeBody, slot.upstreamModel)
          : completeBody;

      let responseBody: unknown = responseBodyStr;
      try {
        responseBody = JSON.parse(responseBodyStr);
      } catch {
        /* leave as string */
      }
      const responseText = extractResponseText(responseBody);
      const aiSignals = analyzeAIResponse(responseText, slotState.aiMetrics.avgResponseLength);
      if (responseText.length > 0) {
        opts.sentimentState.updateAISignals(slot.slotId, aiSignals, responseText.length, sentimentCfg).catch(() => {});
      }

      reply
        .header('X-SentiRoute-Upstream', slot.slotId)
        .header('X-SentiRoute-Score', slotState.score.toFixed(2))
        .header('X-SentiRoute-Relay', outcome.refused ? `retries=${outcome.retries}` : 'none')
        .type('application/json')
        .send(responseBodyStr);
      return;
    }

    // ── Streaming path ──
    if (useRelayForStream) {
      const streamOutcome = await executeWithRelayStream(relayCtx);
      const latencyMs = Date.now() - start;
      const status = streamOutcome.errorResult ? streamOutcome.errorResult.statusCode : 200;
      const relayTag = streamOutcome.refused
        ? `  RELAY(${streamOutcome.retries}${streamOutcome.synthesized ? '+fake' : ''})`
        : '';
      console.log(
        `${nowIso()}  POST /v1/chat/completions  ${slot.slotId}  ${slot.upstreamName}  ${status}  ${latencyMs}ms  STREAM${relayTag}`,
      );

      fileLog.info({
        path: '/v1/chat/completions',
        model: slot.slotId,
        upstream: slot.upstreamName,
        status,
        latency: latencyMs,
        stream: true,
        sentimentScore: slotState.score,
        relayRefused: streamOutcome.refused,
        relayRetries: streamOutcome.retries,
        relaySynthesized: streamOutcome.synthesized,
      });

      if (streamOutcome.errorResult) {
        reply.code(streamOutcome.errorResult.statusCode).type('application/json').send(streamOutcome.errorResult.body);
        return;
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-SentiRoute-Upstream': slot.slotId,
        'X-SentiRoute-Score': slotState.score.toFixed(2),
        'X-SentiRoute-Relay': streamOutcome.refused ? `retries=${streamOutcome.retries}` : 'none',
      });
      reply.hijack();
      reply.raw.write(streamOutcome.sseBuffer);
      reply.raw.end();

      if (streamOutcome.sseBuffer.length > 0) {
        const aiSignals = analyzeAIResponse(streamOutcome.sseBuffer, slotState.aiMetrics.avgResponseLength);
        opts.sentimentState.updateAISignals(slot.slotId, aiSignals, streamOutcome.sseBuffer.length, sentimentCfg).catch(() => {});
      }
      return;
    }

    // ── Streaming path WITHOUT refusal relay (true streaming) ──
    const upstreamBody = translator
      ? JSON.stringify(translator.translateRequest(body, slot.upstreamModel))
      : JSON.stringify({ ...body, model: slot.upstreamModel });

    const result = await (await import('../../proxy/executor.js')).executeUpstream({
      url,
      body: upstreamBody,
      apiKey: slot.apiKey,
      format: slot.format,
      timeoutMs: slot.timeoutMs,
      headers,
    });

    const latencyMs = Date.now() - start;
    const status = result.kind === 'error' ? result.statusCode : 200;
    console.log(`${nowIso()}  POST /v1/chat/completions  ${slot.slotId}  ${slot.upstreamName}  ${status}  ${latencyMs}ms  STREAM`);

    fileLog.info({
      path: '/v1/chat/completions',
      model: slot.slotId,
      upstream: slot.upstreamName,
      status,
      latency: latencyMs,
      stream: true,
      sentimentScore: slotState.score,
    });

    if (result.kind === 'error') {
      reply.code(result.statusCode).type('application/json').send(result.body);
      return;
    }
    if (result.kind === 'complete') {
      reply.type('application/json').send(result.body);
      return;
    }

    const scoreStr = slotState.score.toFixed(2);
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-SentiRoute-Upstream': slot.slotId,
      'X-SentiRoute-Score': scoreStr,
    });
    reply.hijack();

    const rawStream = translator
      ? translator.translateStream(result.stream as any, slot.upstreamModel)
      : (result.stream as any);
    const nodeStream = Readable.fromWeb(rawStream);

    let streamedText = '';
    const origWrite = reply.raw.write.bind(reply.raw);
    (reply.raw as any).write = function(chunk: any, ...args: any[]) {
      if (typeof chunk === 'string') {
        streamedText += chunk;
      } else if (Buffer.isBuffer(chunk)) {
        streamedText += chunk.toString();
      }
      return origWrite(chunk, ...args);
    };

    nodeStream.pipe(reply.raw);

    request.raw.on('close', () => {
      nodeStream.destroy();
      if (streamedText.length > 0) {
        const aiSignals = analyzeAIResponse(streamedText, slotState.aiMetrics.avgResponseLength);
        opts.sentimentState.updateAISignals(slot.slotId, aiSignals, streamedText.length, sentimentCfg).catch(() => {});
      }
    });

    nodeStream.on('error', (err) => {
      fastify.log.error({ err, reqId: request.id }, 'Stream error');
      reply.raw.end();
    });
  });
};

Object.defineProperty(chatPlugin, 'name', { value: 'chat-route' });
export { chatPlugin as chatRoute };
