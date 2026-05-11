---
phase: 02-core-proxy-pipeline
plan: 02
subsystem: server
tags: [fastify, routes, streaming, logging, pino, headers, passthrough]

requires:
  - phase: 02-core-proxy-pipeline
    plan: 01
    provides: resolveSlot(), executeUpstream(), ResolvedSlot, UpstreamResult, UpstreamOptions
provides:
  - POST /v1/messages handler with SSE streaming passthrough
  - POST /v1/chat/completions handler with SSE streaming passthrough
  - pino JSONL request logger with daily rotation and auth redaction
  - Full header and query param forwarding to upstream
  - X-SentiRoute-Upstream and X-SentiRoute-Score response headers
affects: [Phase 3, format translation]

key-files:
  created:
    - src/server/middleware/logging.ts: pino request logger
    - src/server/routes/messages.ts: Anthropic Messages API route
    - src/server/routes/chat.ts: OpenAI Chat Completions API route
  modified:
    - src/server/app.ts: registers all 3 routes + initializes logger
    - src/index.ts: startup proxy endpoint logging
    - src/proxy/executor.ts: added passthrough headers support
    - src/proxy/router.ts: fuzzy model matching

key-decisions:
  - "All client headers forwarded as-is, auth overridden with upstream credentials in executor"
  - "Query string preserved via full incoming URL passthrough (not path-only)"
  - "reply.raw.writeHead() used for streaming headers (reply.header() silently ignored after hijack)"
  - "Readable.fromWeb() converts Web ReadableStream to Node.js Readable for pipe"

patterns-established:
  - "FastifyPluginAsync<{ config: Config }> pattern for all route handlers"
  - "Singleton logger initialized via getRequestLogger() at app creation"
  - "Stream cleanup: request.raw.on('close') destroys nodeStream to kill upstream connection"

requirements-completed: [CORE-01, CORE-02, OBS-01, OBS-03]

metrics:
  duration: 15min
  completed: 2026-05-11
---

# Phase 02 Plan 02: Route Handlers + Logging Summary

**POST /v1/messages, POST /v1/chat/completions, pino JSONL request logger, app wiring**

## Performance

- **Duration:** 15 min (including 2 bugfix rounds)
- **Tasks:** 3 (2 code + 1 human-verify checkpoint)
- **Files created:** 3
- **Files modified:** 5

## Accomplishments

- Created pino request logger writing daily JSONL files with auth header redaction
- Created POST /v1/messages handler with SSE streaming passthrough via reply.hijack()
- Created POST /v1/chat/completions handler (mirrors messages route)
- Registered all 3 routes in app.ts with logger initialization
- Startup logs show proxy endpoint URLs for discoverability
- Fixed fuzzy model matching — slot keys matched by substring in modelId
- Fixed query param forwarding — full incoming URL (with ?beta=true etc.) passed to upstream
- Fixed client header forwarding — all original headers passthrough, auth overridden in executor

## Task Commits

1. **Task 1: Logging middleware + Messages route**
   - `1e71965` feat: create logging middleware and POST /v1/messages route handler

2. **Task 2: Chat route + App wiring**
   - `3b0321e` feat: create POST /v1/chat/completions route and wire all routes in app

3. **Bugfix: Fuzzy model matching**
   - `51063b5` fix: fuzzy model matching - match slot by substring

4. **Bugfix: Header + query param forwarding**
   - `d19ae3e` fix: forward query params and client headers to upstream

## Deviations from Plan

### Bugfix 1: Fuzzy model matching
- **Issue:** resolveSlot() did exact key lookup — `claude-haiku-4-5-20251001` returned "unknown model"
- **User request:** "只要用户端传来的模型包含opus，就用opus配置"
- **Fix:** Changed to substring match: iterate config keys, check if modelId contains key

### Bugfix 2: Header + query param forwarding
- **Issue:** Upstream returned 403 because query params (?beta=true) and client headers (anthropic-beta etc.) were stripped
- **User request:** "你不要专门写对应的参数解析，你直接怎么发来的怎么发出去"
- **Fix:** Full URL passthrough (preserving query string), all headers forwarded as-is, auth headers overridden in executor

## Human Verification

- Server starts and binds to 127.0.0.1:3000
- Claude Code connects through proxy successfully
- Fuzzy model matching works (haiku/sonnet/opus substring match)
- Streaming and non-streaming requests flow through to upstream and back
- X-SentiRoute-* response headers present
- JSONL log file created in logs/ directory

---

*Phase: 02-core-proxy-pipeline*
*Completed: 2026-05-11*
