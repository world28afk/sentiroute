# Roadmap: SentiRoute

## Overview

SentiRoute is a local Node.js/TypeScript HTTP proxy that monitors user sentiment in AI coding tool conversations and automatically switches upstream providers when it detects model degradation or user frustration. This roadmap covers the v1.0 build across 6 phases: project foundation, core proxy pipeline, format translation, sentiment detection with state persistence, auto-switch behavior and observability tooling, and a web dashboard for config management and runtime monitoring.

## Phases

- [x] **Phase 1: Foundation** - Project scaffolding, config loading, health endpoint (completed 2026-05-10)
- [x] **Phase 2: Core Proxy Pipeline** - Anthropic and OpenAI API endpoints, upstream executor, model mapping, request logging (completed 2026-05-11)
- [ ] **Phase 3: Format Translation** - Bidirectional Anthropic <-> OpenAI request/response translation with SSE state machines
- [ ] **Phase 4: Sentiment Detection + State Persistence** - Frustration signal detection, accumulated scoring, disk persistence
- [ ] **Phase 5: Auto-Switch + Polish** - Sentiment-driven upstream switching, cooldown, anti-flapping, CLI status command

## Phase Details

### Phase 1: Foundation
**Goal**: Developer can start SentiRoute, it reads validated config, and reports health
**Depends on**: Nothing (first phase)
**Requirements**: CORE-03, CONF-01, CONF-03
**Success Criteria** (what must be TRUE):
  1. Server starts with `npm start` (or `node dist/index.js`) and binds to a configurable port (default 3000), logging startup info including bound address and config file loaded
  2. GET /health returns JSON with server status, uptime, and the active upstream per configured model slot
  3. A malformed or incomplete config file produces a clear validation error on startup describing what is wrong and where (file path, line number, expected vs actual)
  4. User can define per-model-slot upstream endpoints, API keys, and model name mappings in a YAML config file, and the server accepts them without error
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md -- Project scaffolding (package.json, tsconfig, tsup) + config type contracts (Zod schema, errors, defaults)
- [x] 01-02-PLAN.md -- Config loader with YAML source-position tracking, Zod validation with line-number mapping, Windows-aware path discovery
- [x] 01-03-PLAN.md -- Fastify server factory, GET /health endpoint, entry point wiring, end-to-end startup verification

### Phase 2: Core Proxy Pipeline
**Goal**: Client requests flow through the proxy to upstreams and back with full passthrough and observability
**Depends on**: Phase 1
**Requirements**: CORE-01, CORE-02, CORE-04, CORE-05, CONF-04, OBS-01, OBS-03
**Success Criteria** (what must be TRUE):
  1. Client sends an Anthropic-format POST /v1/messages request and receives a valid SSE streaming response from the upstream with content deltas and stop reason
  2. Client sends an OpenAI-format POST /v1/chat/completions request and receives a valid SSE streaming response with content deltas and finish reason
  3. A request to model ID `claude-opus-4.7` resolves to the configured upstream model string and endpoint (not hardcoded)
  4. Upstream 4xx/5xx errors pass through to the client with the original status code and response body, preserving the error structure
  5. Each request is logged to structured JSONL (pino format) with request ID, model slot, target upstream, and latency
  6. Response includes X-SentiRoute-Upstream and X-SentiRoute-Score headers indicating which upstream served the request
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md -- Config extension (timeoutMs) + proxy core (model slot router, upstream executor with streaming + error passthrough)
- [x] 02-02-PLAN.md -- Route handlers (POST /v1/messages, POST /v1/chat/completions) + request logging middleware + app wiring

### Phase 3: Format Translation
**Goal**: Proxy translates between Anthropic Messages and OpenAI Chat Completions formats bidirectionally with correct SSE streaming
**Depends on**: Phase 2
**Requirements**: FMT-01, FMT-02, FMT-03
**Success Criteria** (what must be TRUE):
  1. An Anthropic-format POST /v1/messages request is internally translated to OpenAI Chat Completions format when routed to an OpenAI-compatible upstream, and the response is returned in the original Anthropic Messages format
  2. An OpenAI-format POST /v1/chat/completions request is internally translated to Anthropic Messages format when routed to an Anthropic-compatible upstream, and the response is returned in the original OpenAI format
  3. SSE streaming translation preserves content block boundaries, tool call boundaries, and stop reasons correctly between formats without malformed output
  4. Reverse translation reconstructs complete response objects matching the original request format's specification (field names, types, required fields)
**Plans**: TBD

### Phase 4: Sentiment Detection + State Persistence
**Goal**: System detects user frustration signals in conversations and persists sentiment state across restarts
**Depends on**: Phase 2
**Requirements**: SENT-01, SENT-02, CONF-02, STATE-01, STATE-02, STATE-03
**Success Criteria** (what must be TRUE):
  1. A user message containing frustration signals (frustration keywords, repetition, caps, rapid retries) increases the per-model-slot sentiment score
  2. Sentiment scores decay over time when neutral or positive messages follow frustration signals, preventing permanent flagging
  3. All per-model-slot sentiment scores and switch state survive a server restart via disk persistence using the conf library
  4. Concurrent requests from multiple tools do not corrupt the state file due to write-queued atomic file persistence
  5. Sentiment sensitivity parameters (threshold, decay rate, signal weights, cooldown duration) are configurable in the YAML config
**Plans**: TBD

### Phase 5: Auto-Switch + Polish
**Goal**: System automatically switches upstreams when frustration is detected; user can monitor system state via CLI
**Depends on**: Phase 2, Phase 4
**Requirements**: SENT-03, SENT-04, SENT-05, OBS-02, OBS-04
**Success Criteria** (what must be TRUE):
  1. When per-slot sentiment score exceeds the configured threshold, subsequent requests are auto-routed to the backup upstream instead of the primary
  2. Primary upstream is automatically retried after the cooldown period expires, with exponential backoff on repeated trigger-cooldown cycles
  3. Rapid switching between primary and backup within a short configurable window is prevented by the anti-flapping lock
  4. Every upstream switch event produces a visible log line with reason, sentiment score at time of switch, and the active upstream chosen
  5. `sentiroute status` CLI command shows current sentiment scores per slot, active upstreams, upstream type (primary/backup), and recent switch history
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete   | 2026-05-10 |
| 2. Core Proxy Pipeline | 2/2 | Complete   | 2026-05-11 |
| 3. Format Translation | TBD | Not started | - |
| 4. Sentiment Detection + State Persistence | TBD | Not started | - |
| 5. Auto-Switch + Polish | TBD | Not started | - |
| 6. Web Dashboard | 0/3 | Not started | - |

### Phase 6: Web Dashboard — Config management UI, runtime parameter tuning, sentiment state viewer, and upstream configuration editor

**Goal:** User opens http://127.0.0.1:3000/dashboard/ and gets a browser-based config editor with masked API keys, runtime parameter sliders with live hot-update, per-slot sentiment score bars with auto-refresh, switch event history tables, and upstream add/edit/remove capabilities.
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07, DASH-08
**Depends on:** Phase 5
**Plans:** 3 plans

Plans:
- [ ] 06-01-PLAN.md — ConfigManager class (mutable config wrapper), YAML write-back, API key masking utility
- [ ] 06-02-PLAN.md — Dashboard API routes (config CRUD, sentiment state viewer, switch history, slot reset) as encapsulated Fastify plugin
- [ ] 06-03-PLAN.md — Dashboard frontend (Alpine.js SPA with dark theme), @fastify/static serving, app.ts/index.ts wiring for ConfigManager
