# Phase 2: Core Proxy Pipeline - Research

**Researched:** 2026-05-11
**Domain:** AI API Proxy Pipeline for Anthropic and OpenAI streaming endpoints
**Confidence:** HIGH (verified against existing codebase, official API docs, and Node.js runtime behavior)

## Summary

Phase 2 builds the core proxy pipeline on top of the Phase 1 foundation (Fastify server, config loading, health endpoint). The primary challenge is implementing a correct SSE streaming passthrough using Fastify's `reply.hijack()` pattern combined with Node.js native `fetch` for upstream communication. Requirements split into three distinct sub-areas: (1) HTTP route handlers for `/v1/messages` and `/v1/chat/completions` with model ID resolution, (2) upstream executor using native fetch with streaming and error passthrough, and (3) observability via structured pino logging and response headers.

**Key architectural insight:** The streaming proxy pattern must use `reply.hijack()` to take control of Fastify's response lifecycle, then pipe the upstream `ReadableStream` through `Readable.fromWeb()` directly to `reply.raw`. This avoids buffering the entire response and maintains true SSE streaming. Error passthrough (4xx/5xx) must happen BEFORE hijack since the error body needs to be captured and sent as a complete response.

**Important deviation from ARCHITECTURE.md:** The earlier architecture doc assumed Express as the HTTP framework, but Phase 1 already implemented Fastify v5.8.5. All patterns in this research use Fastify-specific APIs (`reply.hijack()`, Fastify plugin routes, Fastify logger via pino). Do NOT use Express patterns.

**Primary recommendation:** Build the proxy pipeline as three coarse-grained tasks: (1) proxy router + upstream executor module, (2) route handlers for both API formats with model ID resolution and error passthrough, (3) observability layer (request logging + response headers). This ordering lets each task produce testable output incrementally.

## User Constraints

No CONTEXT.md exists for Phase 2 -- no locked decisions, Claude's discretion, or deferred ideas to carry forward. The research is unconstrained by user decisions beyond the requirements in REQUIREMENTS.md and the Phase 1 decisions recorded in STATE.md.

### Phase 1 Decisions that Constrain Phase 2

| Decision | Impact on Phase 2 |
|----------|-------------------|
| Fastify v5.8.5 with pino logger | Route handlers use Fastify plugin pattern; reply.hijack() for streaming |
| Zod v4 with classic API path (`zod/v4`) | Schema validation uses same import pattern |
| YAML v2 with `parseDocument()` | Config loading already handles model_slots with upstream configs |
| Config schema has `model_slots` with `primary`, `backup`, `upstream_model` | Model ID resolution maps slot key -> primary/backup config |
| VERSION = '0.1.0' hardcoded | Used in response headers |
| Health endpoint excludes api_key field | Same policy applies to proxy logging -- never log api_key values |

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CORE-01 | POST /v1/messages with Anthropic SSE streaming | Fastify reply.hijack() + Readable.fromWeb(response.body) pipe to reply.raw. Anthropic SSE uses `event:` + `data:` lines. Headers: Content-Type text/event-stream, Cache-Control no-cache. |
| CORE-02 | POST /v1/chat/completions with OpenAI SSE streaming | Same Fastify streaming pattern. OpenAI SSE uses `data: {...}\n\n` format with `[DONE]` termination. Route handler mirrors /v1/messages with different endpoint construction. |
| CORE-04 | Model ID mapping (claude-opus-4.7 -> upstream_model) | Router resolves `model_slots[req.body.model]`, picks primary/backup, replaces body.model with upstream_model before forwarding. No format translation in Phase 2. |
| CORE-05 | Upstream executor with native fetch, timeouts, error passthrough, streaming | Node.js built-in fetch. AbortSignal.timeout() for timeouts. !response.ok -> read body as text, reply.status(code).send(body). response.body -> Readable.fromWeb -> pipe to reply.raw for streaming. |
| CONF-04 | Per-upstream API keys forwarded in upstream requests | api_key in config schema. Anthropic: x-api-key header. OpenAI: Authorization: Bearer header. Never log the api_key value. |
| OBS-01 | Structured JSONL request logging with pino | Separate pino destination() writing to rotating log file. Log: reqId, modelSlot, upstream endpoint, latencyMs, statusCode, bytesTransferred. Existing fastify logger uses pino too. |
| OBS-03 | X-SentiRoute-Upstream and X-SentiRoute-Score response headers | Set via reply.header() before hijack for streaming, or via reply.send() for non-streaming/error. Score = "0" until Phase 4 implements sentiment. |

## Standard Stack

### Core (No new dependencies needed)

Phase 2 uses ONLY packages already in package.json plus Node.js built-in APIs:

| Technology | Version | Purpose | Phase 2 Role |
|------------|---------|---------|--------------|
| Fastify | 5.8.5 | HTTP server | Route handlers, reply.hijack() for streaming proxy |
| Node.js fetch | (global) | HTTP client | Upstream requests via native fetch with streaming support |
| pino | 10.3.1 | Logging | Fastify's built-in logger + separate pino.destination() for JSONL request logs |
| TypeScript | 6.0.3 | Language | Type definitions for request/response models |
| zod | 4.4.3 | Schema validation | Adding `timeoutMs` to upstream config schema |

### Node.js Built-in APIs Required

| Module | Import | Purpose |
|--------|--------|---------|
| `node:stream` | `Readable.fromWeb()` | Convert upstream ReadableStream to Node.js Readable for pipe |
| `node:http` | `ServerResponse` | `reply.raw` is the raw `http.ServerResponse` for hijack pattern |
| `node:crypto` | `randomUUID()` | Generate request IDs for logging if not using Fastify's built-in request ID |
| `node:path` | `join()` | Construct log file paths |
| `node:fs` | `mkdirSync()` | Ensure log directory exists on startup |

### Config Schema Addition

Add `timeoutMs` field to `upstreamConfigSchema` in `src/config/schema.ts`:

```typescript
export const upstreamConfigSchema = z.object({
  endpoint: z.string().url('Must be a valid URL'),
  api_key: z.string().min(1, 'API key is required'),
  upstream_model: z.string().min(1, 'Upstream model name is required'),
  format: z.enum(['anthropic', 'openai']),
  timeoutMs: z.coerce.number().int().positive().default(120000),  // NEW
});
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| reply.hijack() + manual pipe | `@fastify/http-proxy` plugin | Plugin is for HTTP CONNECT/forward proxy, not a smart proxy that inspects/modifies request body. Too generic -- we need to intercept model field, replace it, and route per-slot. |
| reply.hijack() + manual pipe | reply.send(stream) | reply.send(stream) works for simple piping but doesn't allow setting headers AFTER the fetch response is received (e.g., error status codes). hijack gives full control. |
| Native fetch | `undici` directly | fetch IS undici in Node 20+. No benefit to importing undici separately. |
| Native fetch | `axios` | Axios doesn't support ReadableStream passthrough. Would buffer entire response. |

## Architecture Patterns

### Recommended File Structure Additions

```
src/
├── config/
│   └── schema.ts              # MODIFY: add timeoutMs field
├── server/
│   ├── app.ts                 # MODIFY: register new route plugins
│   ├── routes/
│   │   ├── health.ts          # EXISTING: unchanged
│   │   ├── messages.ts        # NEW: POST /v1/messages handler
│   │   └── chat.ts            # NEW: POST /v1/chat/completions handler
│   └── middleware/
│       └── logging.ts         # NEW: pino request logger setup
├── proxy/
│   ├── router.ts              # NEW: model slot resolution + upstream selection
│   └── executor.ts            # NEW: upstream fetch with streaming + error passthrough
├── types/
│   └── index.ts               # MODIFY: export new types
└── utils/
    └── version.ts             # EXISTING
```

### Pattern 1: Fastify hijack-based SSE Streaming Proxy

**What:** Use `reply.hijack()` to take full control of the response lifecycle, allowing manual header setting and stream piping. This is the standard pattern for building transparent proxies in Fastify.

**When to use:** Whenever the response needs to be a streaming passthrough where the upstream response headers (status, content-type, etc.) must be forwarded, and the response body is a stream that should not be buffered.

**Sequence:**

```
1. Parse request body, extract model ID
2. Resolve model slot config via router
3. Build upstream URL and headers (replace model name, add API key)
4. Make upstream fetch request
5. CHECK: if !response.ok -> read error body, reply.status(code).send(body) [NO hijack]
6. If streaming (stream: true):
   a. Set response headers on reply.raw (Content-Type, X-SentiRoute-*, Cache-Control)
   b. reply.hijack()
   c. Convert upstream ReadableStream to Node.js Readable: Readable.fromWeb(response.body)
   d. Pipe: upstreamStream.pipe(reply.raw)
   e. Handle cleanup: request.raw.on('close', ...), upstreamStream.on('error', ...)
7. If non-streaming: await response.text(), reply.send(data) with headers
```

**Example:**

```typescript
// proxy/executor.ts
import { Readable } from 'node:stream';

interface ExecutorResult {
  status: 'error' | 'streaming' | 'complete';
  statusCode: number;
  headers: Record<string, string>;
  body?: string;
  stream?: ReadableStream<Uint8Array>;
}

export async function executeUpstreamRequest(
  url: string,
  body: string,
  apiKey: string,
  format: 'anthropic' | 'openai',
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ExecutorResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (format === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal
    ? AbortSignal.any([timeoutSignal, signal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: combinedSignal,
    });
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
    return {
      status: 'error',
      statusCode: isTimeout ? 504 : 502,
      body: JSON.stringify({
        error: {
          type: isTimeout ? 'timeout_error' : 'connection_error',
          message: isTimeout
            ? 'Upstream request timed out'
            : `Upstream connection failed: ${(err as Error).message}`,
        },
      }),
    };
  }

  // Error passthrough: preserve upstream status and body
  if (!response.ok) {
    const errorBody = await response.text();
    return {
      status: 'error',
      statusCode: response.status,
      body: errorBody,
    };
  }

  // Check if streaming
  const bodyText = body;
  const parsedBody = JSON.parse(bodyText);
  if (parsedBody.stream) {
    return {
      status: 'streaming',
      statusCode: 200,
      stream: response.body!,
    };
  }

  // Non-streaming
  const data = await response.text();
  return {
    status: 'complete',
    statusCode: 200,
    body: data,
  };
}
```

### Pattern 2: Fastify Route Handler with Hijack

**What:** The route handler pattern using Fastify plugin registration with config injection.

**Example:**

```typescript
// server/routes/messages.ts
import type { FastifyPluginAsync } from 'fastify';
import { Readable } from 'node:stream';
import type { Config } from '../../config/schema.js';
import { resolveSlot, type ResolvedSlot } from '../../proxy/router.js';
import { executeUpstreamRequest } from '../../proxy/executor.js';

const messagesPlugin: FastifyPluginAsync<{ config: Config }> = async (fastify, opts) => {
  fastify.post('/v1/messages', async (request, reply) => {
    const startTime = Date.now();
    const body = request.body as Record<string, unknown>;

    // 1. Resolve model slot
    const modelId = body.model as string;
    let slot: ResolvedSlot;
    try {
      slot = resolveSlot(opts.config, modelId, 'primary' /* Phase 2: default to primary */);
    } catch (err) {
      return reply.code(400).send({
        error: { type: 'invalid_model', message: `Unknown model: ${modelId}` },
      });
    }

    // 2. Replace model name with upstream model string
    const upstreamBody = { ...body, model: slot.upstreamModel };
    const url = buildUpstreamUrl(slot.endpoint, 'anthropic');

    // 3. Execute upstream request
    const result = await executeUpstreamRequest(
      url,
      JSON.stringify(upstreamBody),
      slot.apiKey,
      'anthropic',
      slot.timeoutMs,
    );

    // 4. Handle errors
    if (result.status === 'error') {
      reply.code(result.statusCode);
      if (result.body) reply.send(result.body);
      logRequest(fastify, request, slot, result.statusCode, Date.now() - startTime);
      return;
    }

    // 5. Handle streaming
    if (result.status === 'streaming' && result.stream) {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-SentiRoute-Upstream': slot.slotId,
        'X-SentiRoute-Score': '0',
      });
      reply.hijack();

      const nodeStream = Readable.fromWeb(result.stream);
      nodeStream.pipe(reply.raw);
      nodeStream.on('error', () => { reply.raw.end(); });
      request.raw.on('close', () => { nodeStream.destroy(); });

      logRequest(fastify, request, slot, 200, Date.now() - startTime);
      return;
    }

    // 6. Non-streaming
    if (result.body) {
      reply.header('X-SentiRoute-Upstream', slot.slotId);
      reply.header('X-SentiRoute-Score', '0');
      reply.send(result.body);
      logRequest(fastify, request, slot, 200, Date.now() - startTime);
    }
  });
};

function buildUpstreamUrl(endpoint: string, format: 'anthropic' | 'openai'): string {
  // Normalize: if endpoint ends with /v1, append /messages or /chat/completions
  // If endpoint is a full path, use as-is
  if (format === 'anthropic') {
    const base = endpoint.endsWith('/v1') ? endpoint : endpoint.replace(/\/?$/, '/v1');
    return `${base}/messages`;
  } else {
    const base = endpoint.endsWith('/v1') ? endpoint : endpoint;
    return `${base}/chat/completions`;
  }
}

function logRequest(
  fastify: FastifyInstance,
  request: FastifyRequest,
  slot: ResolvedSlot,
  statusCode: number,
  latencyMs: number,
): void {
  fastify.log.info({
    reqId: request.id,
    modelSlot: slot.slotId,
    upstream: slot.slotId,  // or endpoint
    statusCode,
    latencyMs,
    method: request.method,
    url: request.url,
  }, 'proxy request');
}

Object.defineProperty(messagesPlugin, 'name', { value: 'messages-route' });
export { messagesPlugin as messagesRoute };
```

### Pattern 3: Model Slot Resolution

**What:** Stateless function that maps a user-visible model ID to the upstream configuration.

```typescript
// proxy/router.ts
export interface ResolvedSlot {
  slotId: string;
  endpoint: string;
  apiKey: string;
  upstreamModel: string;
  format: 'anthropic' | 'openai';
  timeoutMs: number;
  isBackup: boolean;
}

export function resolveSlot(
  config: Config,
  modelId: string,
  upstreamChoice: 'primary' | 'backup' = 'primary',
): ResolvedSlot {
  const slotConfig = config.model_slots[modelId];
  if (!slotConfig) {
    throw new Error(`Unknown model slot: ${modelId}`);
  }

  const upstream = upstreamChoice === 'primary' || !slotConfig.backup
    ? slotConfig.primary
    : slotConfig.backup;

  return {
    slotId: modelId,
    endpoint: upstream.endpoint,
    apiKey: upstream.api_key,
    upstreamModel: upstream.upstream_model,
    format: upstream.format,
    timeoutMs: upstream.timeoutMs ?? 120000,
    isBackup: upstreamChoice === 'backup',
  };
}
```

### Anti-Patterns to Avoid

- **Buffering SSE response before sending:** Do NOT `await response.text()` on a streaming response. This defeats the purpose of streaming and adds latency. Use `Readable.fromWeb(response.body)` and pipe directly.
- **Calling reply.hijack() before the async fetch:** If the fetch throws (network error, timeout), you've already hijacked and must manually send the error response on reply.raw. Either: (a) await the fetch first, check for errors, THEN hijack for streaming, or (b) use a try/catch around the hijacked section. Option (a) is cleaner.
- **Forgetting to handle client disconnect:** Always listen for `request.raw.on('close')` to destroy the upstream stream. Otherwise, the upstream connection stays open wasting resources.
- **Global request ID collision:** Fastify generates request IDs by default, but ensure the ID generator produces unique values across restarts. Default Fastify request IDs use a counter (`req-1`, `req-2`) which resets on restart.
- **Hardcoding upstream paths:** The upstream URL in config specifies the base endpoint (e.g., `https://api.anthropic.com/v1`), and the route handler appends `/messages` or `/chat/completions`. Some configs may specify the full path -- handle both cases.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSE stream piping from fetch to HTTP response | Custom stream reader/writer with chunk parsing | Node.js `Readable.fromWeb(response.body).pipe(reply.raw)` | Native stream pipe handles backpressure, error propagation, and end-of-stream correctly. Custom implementations commonly have memory leaks or backpressure bugs. |
| Request timeout handling | Manual setTimeout + abort logic | `AbortSignal.timeout(timeoutMs)` combined with fetch | Native API, handles all edge cases (DNS resolution timeout, connection timeout, response timeout). No library needed. |
| Structured logging | Custom JSON log formatter | Pino via `pino.destination()` to file | Already in the dependency tree. pino handles JSON serialization, log levels, and file I/O efficiently. Fastify's internal logger uses pino too, so log format is consistent. |
| Request ID generation | UUID v4 from scratch | `fastify.requestIdHeader` or `crypto.randomUUID()` | Fastify can auto-generate or forward x-request-id. Node 19+ has `crypto.randomUUID()` built-in. No uuid package needed. |
| API key header forwarding | Custom logic per provider type | Map upstream.format to standard header convention | Two cases only: Anthropic -> x-api-key, OpenAI -> Authorization: Bearer. A simple switch/if-else is correct. |

**Key insight:** The streaming proxy pipeline is fundamentally about piping bytes efficiently. Node.js stream APIs handle the complex parts (backpressure, buffering, error propagation, cleanup). Avoid re-implementing stream manipulation -- pipe is the correct abstraction.

## Common Pitfalls

### Pitfall 1: reply.hijack() Timing

**What goes wrong:** Calling `reply.hijack()` before awaiting the upstream fetch means errors during the fetch (network failure, timeout, DNS resolution failure) leave you in a hijacked state with no way to send a proper error response through Fastify's reply.send().

**Why it happens:** The natural impulse is to hijack early ("I know this will be streaming"), but errors between hijack and pipe force you to use `reply.raw.end(JSON.stringify({error}))` manually, bypassing Fastify's content-type negotiation and serialization.

**How to avoid:** Always await the fetch call first. Only call hijack AFTER confirming the response is a 200 success with streaming body. For error responses (!response.ok), use `reply.code(status).send(body)` without hijacking.

**Warning signs:** Routes where hijack() appears before the first await. Route handlers that mix `reply.send()` and `reply.hijack()` in the same function path without clear separation.

### Pitfall 2: SSE Connection Not Closed on Client Disconnect

**What goes wrong:** Client closes the connection (navigates away, closes coding tool, network issue). The upstream fetch is still reading and piping data. The connection to the upstream API provider stays open, wasting quota and potentially incurring cost for unused tokens.

**Why it happens:** Node.js streams don't auto-destroy when the writable side closes. The `pipe()` operation only propagates 'end' signals, not 'close' signals.

**How to avoid:**
```typescript
request.raw.on('close', () => {
  nodeStream.destroy();  // destroys the Readable wrapper
  // If you have the AbortController, also abort: controller.abort()
});
```

**Warning signs:** Long-running proxy connections that don't clean up when the client disconnects.

### Pitfall 3: API Key Leakage in Logs

**What goes wrong:** The request body contains the upstream API key only in headers, not the body. But a debug log that serializes the full response headers or request body could inadvertently include API keys passed through in the body (unlikely with Anthropic/OpenAI) or in the Authorization header (if the upstream response includes such headers). More commonly, the Proxy's own config containing api_key values is at risk if the config path is logged.

**Why it happens:** Logging is too broad -- "log everything for debugging" includes sensitive fields.

**How to avoid:**
- Never log `request.body` raw -- extract specific fields (model, stream)
- Never log upstream `api_key` value in any log entry
- Use pino redact option if needed: `pino({ redact: ['req.headers.authorization', 'req.headers.x-api-key'] })`
- The config already stores api_key per-upstream -- don't echo it back

**Warning signs:** A log line containing the literal string `sk-ant-` or `sk-or-` or similar API key prefix.

### Pitfall 4: Upstream URL Path Normalization

**What goes wrong:** Users configure upstream endpoints inconsistently: `https://api.anthropic.com/v1`, `https://api.anthropic.com/v1/`, `https://api.anthropic.com`, or even `https://api.anthropic.com/v1/messages`. The proxy appends `/messages` or `/chat/completions` and creates malformed URLs like `https://api.anthropic.com/v1/messages/messages`.

**Why it happens:** No URL normalization in the executor/router.

**How to avoid:**
```typescript
function normalizeUrl(endpoint: string, path: string): string {
  const base = endpoint.replace(/\/+$/, '');
  // If endpoint already ends with the path segment, don't append again
  if (base.endsWith(path)) return base;
  // If endpoint ends with /v1, append the path
  if (base.endsWith('/v1')) return `${base}${path}`;
  // Raw endpoint, append /v1 + path
  return `${base}/v1${path}`;
}
// Usage: normalizeUrl(endpoint, '/messages')
```

### Pitfall 5: Non-Streaming Request with stream:false

**What goes wrong:** The proxy assumes all proxied requests are streaming and uses the hijack path. A non-streaming request (stream: false or absent) should return a complete JSON response, not an SSE stream.

**Why it happens:** Coding tools typically use stream:true, but integration tests and curl commands use stream:false. The proxy must handle both.

**How to avoid:** Check `body.stream` === true explicitly before entering the SSE streaming path. For all other cases (false, undefined, null), use the non-streaming path: `await response.text()` then `reply.send()`.

**Warning signs:** curl requests returning SSE headers with a single complete JSON blob, or streaming requests returning complete JSON without SSE framing.

### Pitfall 6: Missing X-SentiRoute-* Headers on Streaming Responses

**What goes wrong:** Custom headers added via `reply.header()` are NOT sent when using `reply.hijack()` because hijack bypasses Fastify's header-sending logic. The headers must be set directly on `reply.raw.writeHead()`.

**How to avoid:** When using reply.hijack(), ALWAYS set response headers inline in the `writeHead()` call:
```typescript
reply.raw.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'X-SentiRoute-Upstream': slotId,
  'X-SentiRoute-Score': score,
});
```
Do NOT use `reply.header()` before `reply.hijack()` -- those headers will be silently dropped.

## Observable Pipeline

### Request Lifecycle with Logging Points

```
Client POST /v1/messages
  │
  ├─ [1] Fastify receives: request.id generated, logger context started
  │
  ├─ [2] Route handler: parse body, extract modelId
  │   LOG: { reqId, modelId, stream: true }
  │
  ├─ [3] Router: resolveSlot(config, modelId)
  │   LOG: { reqId, slotId, upstream: endpoint, isBackup }
  │
  ├─ [4] Executor: fetch(upstreamUrl, { method: 'POST', headers, body, signal })
  │   (do NOT log body or api_key)
  │
  ├─ [5a] ERROR (4xx/5xx): reply.code(status).send(errorBody)
  │   LOG: { reqId, statusCode, latencyMs, errorBodySize }
  │
  ├─ [5b] STREAMING: reply.raw.writeHead(200, { X-SentiRoute-Upstream, ... })
  │   reply.hijack()
  │   Readable.fromWeb(response.body).pipe(reply.raw)
  │   LOG: { reqId, statusCode: 200, latencyMs, stream: true }
  │
  └─ [6] Client disconnected: destroy upstream stream
      LOG: { reqId, event: 'client_disconnect', totalBytes }
```

### Pino Log Schema (OBS-01)

```typescript
interface RequestLogEntry {
  level: 30;                    // pino INFO level
  time: number;                 // epoch ms
  reqId: string;                // Fastify request ID
  method: string;               // POST
  url: string;                  // '/v1/messages' | '/v1/chat/completions'
  modelSlot: string;            // e.g. 'claude-opus-4-7'
  upstream: string;             // upstream endpoint URL (without api_key)
  isBackup: boolean;
  statusCode: number;
  latencyMs: number;
  stream: boolean;
  contentLength?: number;       // for non-streaming, bytes in response
  error?: string;               // for error responses
  // NEVER include: api_key, request.body content, response body content
}
```

### Response Headers (OBS-03)

| Header | Value | When |
|--------|-------|------|
| `X-SentiRoute-Upstream` | Model slot ID (e.g., `claude-opus-4-7`) | All responses |
| `X-SentiRoute-Score` | Current sentiment score for slot (Phase 2: always `0`) | All responses |

These headers are set via `reply.raw.writeHead()` for streaming responses (after hijack) or via `reply.header()` for error/non-streaming responses.

### Logging Implementation

```typescript
// server/middleware/logging.ts
import pino from 'pino';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let requestLogger: pino.Logger | null = null;

export function getRequestLogger(dataDir: string): pino.Logger {
  if (requestLogger) return requestLogger;

  const logDir = join(dataDir, 'logs');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const today = new Date().toISOString().slice(0, 10);
  const logPath = join(logDir, `${today}.jsonl`);

  requestLogger = pino(
    { level: 'info' },
    pino.destination({ dest: logPath, sync: false }),
  );

  return requestLogger;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express + axios for proxy | Fastify + native fetch | 2024-2025 | Fastify's hijack + native ReadableStream is cleaner, faster, and has fewer deps. |
| Response buffering for translation | Per-chunk stream translation | 2023+ (Vercel AI SDK pattern) | Phase 3 will translate chunks on-the-fly, but Phase 2 must not buffer -- pipe raw. |
| undici directly | Native global fetch | Node 21+ | fetch is stable and globally available. No import needed. |
| `uuid` package | `crypto.randomUUID()` | Node 19+ | One less dependency. Built-in UUID generation. |

## Open Questions

1. **How should the upstream URL normalization handle arbitrary endpoints?**
   - What we know: Users configure `endpoint` in config. For Anthropic it's typically `https://api.anthropic.com/v1`, for OpenAI `https://api.openai.com/v1`.
   - What's unclear: Users might specify the full path (`https://api.anthropic.com/v1/messages`) or a custom proxy endpoint. URL normalization logic needs to handle both cases.
   - Recommendation: Check if endpoint already ends with the target path segment. If it does, use as-is. Otherwise, append accordingly. Document the expected format in example configs.

2. **Should the pino request logger write to a single file or rotate daily?**
   - What we know: `pino.destination()` handles append-only writes. File grows unbounded.
   - What's unclear: Whether daily rotation is needed for Phase 2 (low traffic, single user).
   - Recommendation: Start with a single file per day (`YYYY-MM-DD.jsonl`). Add rotation in a later observability phase (Phase 5) if needed. Document that logs are append-only and users should clean them periodically.

3. **What is the exact set of upstream response headers to forward to the client?**
   - What we know: Content-Type must be preserved (text/event-stream for SSE). CORS headers may matter for browser-based clients.
   - What's unclear: Which upstream headers to pass vs. strip. `set-cookie`, `x-request-id`, rate-limit headers from upstream could surprise the client.
   - Recommendation: For Phase 2, pass only Content-Type and Cache-Control. Strip all other upstream headers. Add selective forwarding based on phase requirements in Phase 5.

4. **Should `AbortSignal.any()` or `AbortSignal.timeout()` be polyfilled for older Node?**
   - What we know: `AbortSignal.timeout()` is available from Node 16. `AbortSignal.any()` is available from Node 20.
   - What's unclear: Node 18 is the stated minimum but `AbortSignal.any()` isn't available there.
   - Recommendation: Use `AbortSignal.timeout()` only (available in Node 18+). Don't use `AbortSignal.any()`. If combining timeout + client disconnect signals, use manual AbortController management or feature-detect.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | YES | 24.13.0 | -- |
| npm | Package management | YES | (bundled) | -- |
| native fetch | Upstream HTTP client | YES (global) | Node 24 | -- |
| ReadableStream | SSE streaming | YES (global) | Web Streams API | -- |
| AbortSignal.timeout | Request timeout | YES | Node 16+ | -- |
| AbortSignal.any | Combined signals | NO | Node 20+ | Manual AbortController arbitration |
| `crypto.randomUUID()` | Request ID generation | YES | Node 19+ | -- |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:**
- `AbortSignal.any()` is NOT available in Node 18. Since we target Node 18+, use manual `AbortController` with event listeners for combining signals:
```typescript
function combineAbortSignals(...signals: AbortSignal[]): AbortController {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller;
}
```

## Code Examples

### Verified patterns from official sources and existing codebase:

### Pattern A: Upstream Executor with Full Error Passthrough

```typescript
// proxy/executor.ts
import { Readable } from 'node:stream';

export type UpstreamResult =
  | { kind: 'error'; statusCode: number; body: string }
  | { kind: 'streaming'; stream: ReadableStream<Uint8Array> }
  | { kind: 'complete'; body: string };

export interface UpstreamOptions {
  url: string;
  body: string;
  apiKey: string;
  format: 'anthropic' | 'openai';
  timeoutMs: number;
  signal?: AbortSignal;
}

export async function executeUpstream(opts: UpstreamOptions): Promise<UpstreamResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (opts.format === 'anthropic') {
    headers['x-api-key'] = opts.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = `Bearer ${opts.apiKey}`;
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(new Error('timeout')), opts.timeoutMs);

  try {
    const signal = opts.signal
      ? combineSignals(timeoutController.signal, opts.signal)
      : timeoutController.signal;

    const response = await fetch(opts.url, {
      method: 'POST',
      headers,
      body: opts.body,
      signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return { kind: 'error', statusCode: response.status, body: errorBody };
    }

    const parsed = JSON.parse(opts.body);
    if (parsed.stream !== true) {
      const data = await response.text();
      return { kind: 'complete', body: data };
    }

    return { kind: 'streaming', stream: response.body! };
  } catch (err) {
    const message = (err as Error).message;
    const statusCode = message === 'timeout' ? 504 : 502;
    return {
      kind: 'error',
      statusCode,
      body: JSON.stringify({
        error: {
          type: statusCode === 504 ? 'timeout_error' : 'upstream_error',
          message: statusCode === 504
            ? 'Upstream request timed out'
            : `Upstream error: ${message}`,
        },
      }),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function combineSignals(...signals: AbortSignal[]): AbortSignal {
  // Node 18-compatible signal combining without AbortSignal.any()
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}
```

### Pattern B: Route Handler with Streaming and Error Handling

```typescript
// server/routes/messages.ts
import type { FastifyPluginAsync } from 'fastify';
import { Readable } from 'node:stream';
import type { Config } from '../../config/schema.js';
import { resolveSlot } from '../../proxy/router.js';
import { executeUpstream } from '../../proxy/executor.js';

const messagesPlugin: FastifyPluginAsync<{ config: Config }> = async (fastify, opts) => {
  fastify.post('/v1/messages', async (request, reply) => {
    const start = Date.now();
    const body = request.body as Record<string, unknown>;
    const modelId = body.model as string;

    // Resolve model slot
    let slot;
    try {
      slot = resolveSlot(opts.config, modelId);
    } catch {
      return reply.code(400).send({
        error: { type: 'invalid_request_error', message: `Unknown model: ${modelId}` },
      });
    }

    // Construct upstream body with mapped model name
    const upstreamBody = JSON.stringify({ ...body, model: slot.upstreamModel });

    // Build upstream URL
    const endpoint = slot.endpoint.replace(/\/+$/, '');
    const url = endpoint.endsWith('/v1') ? `${endpoint}/messages` : `${endpoint}/v1/messages`;

    // Execute upstream
    const result = await executeUpstream({
      url,
      body: upstreamBody,
      apiKey: slot.apiKey,
      format: slot.format,
      timeoutMs: slot.timeoutMs,
    });

    // Error passthrough
    if (result.kind === 'error') {
      reply.code(result.statusCode).type('application/json').send(result.body);
      log(fastify, request, slot, result.statusCode, Date.now() - start);
      return;
    }

    // Non-streaming
    if (result.kind === 'complete') {
      reply
        .header('X-SentiRoute-Upstream', slot.slotId)
        .header('X-SentiRoute-Score', '0')
        .send(result.body);
      log(fastify, request, slot, 200, Date.now() - start);
      return;
    }

    // Streaming - must use reply.raw.writeHead (reply.header() doesn't work after hijack)
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-SentiRoute-Upstream': slot.slotId,
      'X-SentiRoute-Score': '0',
    });
    reply.hijack();

    const nodeStream = Readable.fromWeb(result.stream);
    nodeStream.pipe(reply.raw);

    // Cleanup on client disconnect
    request.raw.on('close', () => {
      nodeStream.destroy();
    });

    nodeStream.on('error', (err) => {
      fastify.log.error({ err, reqId: request.id }, 'Stream error');
      reply.raw.end();
    });

    log(fastify, request, slot, 200, Date.now() - start);
  });
};

function log(
  fastify: any,
  request: any,
  slot: any,
  statusCode: number,
  latencyMs: number,
): void {
  fastify.log.info({
    reqId: request.id,
    modelSlot: slot.slotId,
    upstream: slot.slotId,
    isBackup: slot.isBackup,
    statusCode,
    latencyMs,
    stream: (request.body as any).stream === true,
  }, 'proxy');
}

export { messagesPlugin as messagesRoute };
```

### Pattern C: Updating app.ts to Register Both Routes

```typescript
// server/app.ts - MODIFIED for Phase 2
import Fastify from 'fastify';
import type { Config } from '../config/schema.js';
import { healthRoute } from './routes/health.js';
import { messagesRoute } from './routes/messages.js';
import { chatRoute } from './routes/chat.js';

export function createApp(config: Config) {
  const app = Fastify({
    logger: {
      level: 'info',
    },
  });

  // Register a request-id generator (Fastify default is fine for Phase 2)
  app.register(healthRoute, { config });
  app.register(messagesRoute, { config });
  app.register(chatRoute, { config });

  return app;
}
```

### Pattern D: OpenAI Chat Completions Route (Mirrors Messages Route)

```typescript
// server/routes/chat.ts
// Nearly identical to messages.ts but POST /v1/chat/completions
// and uses endpoint building: `${endpoint}/chat/completions` or `${endpoint}/v1/chat/completions`
// OpenAI SSE format is different framing but the pipe is the same raw passthrough
```

The OpenAI route handler is structurally identical to the Anthropic messages handler. The only differences:
1. Route path: `POST /v1/chat/completions`
2. Upstream URL: append `/chat/completions` instead of `/messages`
3. Auth header: `Authorization: Bearer <key>` instead of `x-api-key`
4. Optionally add `OpenAI-Organization` and `OpenAI-Project` headers if present in upstream config extras

The streaming passthrough is identical -- both APIs use SSE, the proxy doesn't parse or translate in Phase 2.

## Sources

### Primary (HIGH confidence)
- Existing Phase 1 codebase -- confirms Fastify pattern, config schema, Zod validation, YAML loading
- Node.js v24.13.0 runtime -- confirmed on local environment, supports all Web Streams API features
- Fastify npm package v5.8.5 -- confirmed installed and working in existing codebase

### Secondary (MEDIUM confidence)
- Anthropic Messages API streaming specification -- SSE event types, header conventions, request format (from PR training data + official docs)
- OpenAI Chat Completions API streaming specification -- SSE event types, chunk format, finish_reason values (from PR training data + official docs)
- Node.js Readable.fromWeb() documentation -- conversion of Web Streams ReadableStream to Node.js Readable stream
- AbortSignal.timeout() and AbortController behavior -- Node.js 18+ compatible patterns

### Tertiary (LOW confidence)
- URL normalization edge cases -- behavior depends on user config patterns, verified during Phase 2 implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all already verified in Phase 1
- Architecture: HIGH -- Fastify hijack pattern is standard for Node.js proxy servers; verified through existing codebase patterns
- Pitfalls: HIGH -- based on well-known Node.js stream behavior and Fastify API contract

**Research date:** 2026-05-11
**Valid until:** N/A (no time-sensitive dependencies -- built on stable Node.js APIs and Fastify v5)
