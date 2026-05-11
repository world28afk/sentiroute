import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import type { Config, SentimentConfig } from '../../config/schema.js';
import { resolveSlot } from '../../proxy/router.js';
import { executeUpstream } from '../../proxy/executor.js';
import { getRequestLogger } from '../middleware/logging.js';
import { getTranslator } from '../../translation/registry.js';
import { SentimentState } from '../../sentiment/state.js';
import { analyzeSentiment, extractUserMessages, DEFAULT_WEIGHTS } from '../../sentiment/signals.js';
import { applySentimentSwitch } from '../../sentiment/switch.js';

function buildUpstreamUrl(endpoint: string, incomingUrl: string): string {
  const base = endpoint.replace(/\/+$/, '');
  const url = new URL(incomingUrl, 'http://localhost');
  const pathAndQuery = url.pathname + url.search;
  if (base.endsWith('/v1') && pathAndQuery.startsWith('/v1/')) {
    return base + pathAndQuery.slice(3);
  }
  return base + pathAndQuery;
}

function passthroughHeaders(req: FastifyRequest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined) {
      out[k] = Array.isArray(v) ? v.join(', ') : v;
    }
  }
  return out;
}

function now(): string {
  return new Date().toISOString();
}

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
      const msg = `${now()}  POST /v1/chat/completions  ${modelId}  ?  -`;
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
      console.log(`${now()}  SWITCH  ${slot.slotId}  ${switchResult.reason}`);
    }

    const translator = getTranslator('openai', slot.format);

    let upstreamBody: string;
    if (translator) {
      upstreamBody = JSON.stringify(translator.translateRequest(body, slot.upstreamModel));
    } else {
      upstreamBody = JSON.stringify({ ...body, model: slot.upstreamModel });
    }

    const url = buildUpstreamUrl(slot.endpoint, request.raw.url ?? '/v1/chat/completions');

    const result = await executeUpstream({
      url,
      body: upstreamBody,
      apiKey: slot.apiKey,
      format: slot.format,
      timeoutMs: slot.timeoutMs,
      headers: passthroughHeaders(request),
    });

    const latencyMs = Date.now() - start;
    const status = result.kind === 'error' ? result.statusCode : 200;
    console.log(`${now()}  POST /v1/chat/completions  ${slot.slotId}  ${slot.upstreamName}  ${status}  ${latencyMs}ms`);

    fileLog.info({
      path: '/v1/chat/completions',
      model: slot.slotId,
      upstream: slot.upstreamName,
      status,
      latency: latencyMs,
      stream: isStream,
      sentimentScore: slotState.score,
    });

    if (result.kind === 'error') {
      reply.code(result.statusCode).type('application/json').send(result.body);
      return;
    }

    const scoreStr = slotState.score.toFixed(2);

    if (result.kind === 'complete') {
      const responseBody = translator
        ? translator.translateResponse(result.body, slot.upstreamModel)
        : result.body;
      reply
        .header('X-SentiRoute-Upstream', slot.slotId)
        .header('X-SentiRoute-Score', scoreStr)
        .send(responseBody);
      return;
    }

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
    nodeStream.pipe(reply.raw);

    request.raw.on('close', () => {
      nodeStream.destroy();
    });

    nodeStream.on('error', (err) => {
      fastify.log.error({ err, reqId: request.id }, 'Stream error');
      reply.raw.end();
    });
  });
};

Object.defineProperty(chatPlugin, 'name', { value: 'chat-route' });
export { chatPlugin as chatRoute };
