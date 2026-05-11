# Project Research Summary

**Project:** SentiRoute -- Sentiment-Driven AI Upstream Adapter
**Domain:** AI API Routing Proxy with Sentiment-Based Switching
**Researched:** 2026-05-11
**Confidence:** HIGH

## Executive Summary

SentiRoute is a local AI API proxy that monitors user sentiment in conversations with coding tools (Claude Code, Cursor, etc.) and automatically switches upstream providers when it detects model degradation or user frustration. This is a novel product category: existing proxies like 9router and LiteLLM handle quota management, multi-provider routing, and token compression, but none use sentiment as a switching signal. The research confirms that a lightweight, dependency-minimal architecture with custom format translation is the right approach.

The recommended stack is a Node.js 24/TypeScript 6.0 application using Fastify as the HTTP framework, native fetch for upstream calls, custom format translators (no heavy AI SDK), a domain-specific keyword/heuristic frustration detector (no general NLP libraries), conf for state persistence, and yaml + zod for configuration. The architecture follows a well-established middleware pipeline pattern verified against 9router and Portkey Gateway: request interception, sentiment analysis, routing decision, format translation, upstream execution, and response pipeline.

The three critical risks are: (1) SSE streaming translation between Anthropic and OpenAI formats is surprisingly nuanced and can produce malformed output if not handled with per-stream state machines, (2) sentiment analysis on coding conversations is prone to false positives since developers use frustration-like language about code constantly, and (3) state file corruption under concurrent requests requires atomic writes and a write queue from day one. All three have concrete, implementable mitigations.

## Key Findings

### Recommended Stack

The STACK research (HIGH confidence, all versions npm-verified) recommends a lean dependency tree (~20 transitive deps total) optimized for a latency-sensitive local proxy.

**Core technologies:**
- **Node.js 24 LTS:** Runtime. Native fetch and Web Streams API available globally. Avoids adding any HTTP client library.
- **TypeScript 6.0.3:** Language. Latest stable with improved type inference and const type parameters.
- **Fastify 5.8.5:** HTTP server. Zero-overhead schema serialization, streaming with backpressure, plugin ecosystem. 2-3x faster JSON serialization than Express 5. Hono edge-compute focus buys nothing for a local proxy.
- **Custom format translators:** No third-party translation library (Vercel AI SDK adds 50+ deps). Well-defined data transformation against documented API specs.
- **Custom domain-specific frustration detector:** No general NLP library (sentiment is 7 years stale, natural adds 15+ deps). Uses a weighted keyword/phrase approach tuned for coding-tool frustration signals.
- **conf 15.1.0:** State persistence. Atomic file writes, dot-property access, platform-appropriate locations. Avoids raw JSON race conditions and SQLite overkill.
- **yaml 2.8.4 + zod 4.4.3:** Config parsing and validation. YAML is standard for dev tools; Zod provides type inference and clear error messages.
- **pino 10.3.1:** Structured JSON logging. Fastest Node.js JSON logger. Structured fields for request IDs, sentiment scores, switch events.
- **@anthropic-ai/sdk 0.95.1 + openai 6.37.0:** Type definitions only. Runtime imports for type guards in the translation layer.

**Reconciliation note:** The ARCHITECTURE research originally proposed Express. The STACK research provides a more detailed comparison showing Fastify is the better choice (streaming, schema serialization, TypeScript DX, plugin ecosystem). Fastify supports the same middleware pipeline pattern.

### Expected Features

The FEATURES research (MEDIUM-HIGH confidence, verified against 9router and LiteLLM READMEs) maps the competitive landscape.

**Must have (table stakes):**
- OpenAI-compatible endpoint (/v1/chat/completions) -- every coding tool speaks this
- Anthropic endpoint (/v1/messages) -- Claude Code speaks this natively
- Bidirectional format translation (Anthropic <-> OpenAI) -- hardest table-stakes feature
- Configurable upstream endpoints with per-upstream API keys
- Model ID mapping -- user says a model name, proxy maps per upstream
- Streaming SSE passthrough without buffering
- Health/status endpoint
- Config file + env var setup

**Core differentiator (must ship):**
- **Sentiment-based upstream switching** -- no competitor does this. Accumulated per-model-slot score, threshold trigger, cooldown with exponential backoff, automatic primary retry.

**Should have (competitive):**
- Keyword/heuristic frustration detection (v1)
- Configurable sensitivity per model slot
- Switch history and transparent logging
- X-SentiRoute response headers indicating active upstream
- CLI status command

**Defer (v2+):**
- ML-based sentiment classification (ONNX/transformers.js)
- Token compression (RTK integration)
- Multi-tier fallback chains
- Request caching (dangerous with AI, not aligned with routing)

**Anti-features (explicitly out of scope):**
- Quota/rate-limit tracking (9router owns this niche)
- Web/GUI dashboard (CLI-only tool)
- Built-in provider integrations (users bring their own upstreams)
- Multi-user/multi-tenant
- Load balancing or round-robin

### Architecture Approach

The architecture follows a layered middleware pipeline verified against 9router and Portkey Gateway codebases (HIGH confidence). Each request flows through: HTTP Server, Auth Middleware, Request Interceptor, Sentiment Analyzer + State Manager, Router, Format Translator, Upstream Executor, Response Pipeline.

**Major components:**
1. **HTTP Server (Fastify):** Routes POST /v1/messages, POST /v1/chat/completions, GET /health. Configurable port. JSON body parsing, streaming SSE passthrough.
2. **Sentiment Analyzer:** Scans user messages for frustration signals (explicit keywords, repetition, short retries, negation, caps, rapid retry). Per-model-slot accumulation with decay. Dual-threshold system prevents false positives.
3. **State Manager:** In-memory cache + debounced atomic JSON persistence. Per-slot state. Write queue eliminates concurrent write races.
4. **Router:** Resolves model ID to slot config, consults state manager for primary/backup decision. Handles cooldown expiry (auto-retry primary). Anti-flapping lock.
5. **Format Translator:** Bidirectional Anthropic <-> OpenAI translation. SSE event-by-event transducers (not buffered converters). Per-stream state machine tracking content block index, tool call state, stop reasons.
6. **Upstream Executor:** Generic HTTP client using native fetch. Handles streaming and non-streaming. Configurable timeouts. Error handling (4xx/5xx passthrough, 502/504).

**Key design decisions:**
- Format Translation and Sentiment Analysis are independent -- they can be built in parallel after core proxy skeleton
- Sentiment analysis must stay local and lightweight (<1ms per request for fast pre-check)
- State persistence uses write-queued atomic rename (no SQLite needed)
- Upstream executor is generic (not per-provider specialized like 9router)

### Critical Pitfalls

The PITFALLS research (HIGH confidence) identifies 11 pitfalls. The four critical ones:

1. **SSE Streaming Format Translation Malformed Output (Critical).** Anthropic uses multi-event content block lifecycle; OpenAI uses flat delta structure. Tool call boundary mismatches, content index desync, lossy stop reason mapping. Prevention: SSE event-by-event transducers with per-stream state machines. Explicit conformance tests.

2. **Sentiment Analysis False Positives on Technical Language (Critical).** Developers constantly use frustration-adjacent language about code. >80% false positive rate with generic approaches. Prevention: Target model-directed frustration only. Track user:assistant message length ratios. Dual-threshold. Logging-only mode first.

3. **State File Corruption Under Concurrent Requests (Critical).** Read-modify-write race with multiple tools. Partial writes on crash. Cross-slot contamination. Prevention: Write queue serializes all mutations. Atomic rename. Debounce writes. Per-slot files or write lock. Rotating backups.

4. **Proxy Opacity Destroys User Trust (Critical).** Silent switches confuse users. Log noise buries signal. Switch thrashing causes stuttering. Prevention: Every switch event gets visible log line. Status endpoint. Anti-flapping lock. Manual override. Do not ship before this is implemented.

## Implications for Roadmap

Based on combined research, the recommended build order is 6 phases. Phases 3 and 4 are architecturally independent and could be parallelized.

### Phase 1: Skeleton + Config
**Rationale:** No dependencies. Establishes project skeleton and bootable server.
**Delivers:** npm start boots a server with health check. Config validated on load.
**Addresses:** CONF-01, CONF-03, LOG-01, health endpoint.
**Stack:** Fastify, TypeScript, yaml + zod, pino, conf.
**Avoids:** Pitfall 8 (port conflicts), Pitfall 9 (config discovery).

### Phase 2: Core Proxy Pipeline
**Rationale:** Depends on Phase 1. Critical path for end-to-end testing.
**Delivers:** Full proxy passthrough. SSE streaming. Model ID mapping.
**Addresses:** CORE-01, CORE-02, CORE-03, upstream executor.
**Key architecture:** HTTP Server, Request Interceptor, Router, Upstream Executor.
**Avoids:** Pitfall 3 (write queue + atomic writes from day one), Pitfall 11 (log sanitizer).

### Phase 3: Format Translation
**Rationale:** Depends on Phase 2. Independent from Phase 4.
**Delivers:** Bidirectional Anthropic <-> OpenAI translation with SSE transducers.
**Addresses:** FMT-01, response reverse-translation.
**Key architecture:** Format Translator with per-stream state machines.
**Avoids:** Pitfall 1 (conformance tests, state machines), Pitfall 5 (field mapping table).

### Phase 4: Sentiment Analysis
**Rationale:** Depends on Phase 2. Independent from Phase 3.
**Delivers:** Per-request scoring, signal detection, logging-only mode.
**Addresses:** SENT-01, SENT-02.
**Key architecture:** Sentiment Analyzer with signal detectors.
**Avoids:** Pitfall 2 (dual-threshold, calibration), Pitfall 7 (fast pre-check).

**Research flag:** Signal patterns need validation against real conversations. Consider log-collection sub-task.

### Phase 5: State Management + Auto-Switch
**Rationale:** Depends on Phase 2 and Phase 4.
**Delivers:** Full sentiment-driven switching with cooldown and anti-flapping.
**Addresses:** SENT-03, SENT-04, CONF-02, status endpoint.
**Key architecture:** State Manager, Router (full), Cooldown Timer.
**Avoids:** Pitfall 4 (visible log lines, status endpoint, manual override), Pitfall 6 (backups, shutdown hooks).

**Research flag:** Cooldown timing and anti-flapping need empirical tuning. Plan beta period.

### Phase 6: Observability + Polish
**Rationale:** Depends on Phase 5.
**Delivers:** Structured logging, graceful shutdown, CLI status command.
**Addresses:** Enhanced LOG-01, graceful shutdown.
**Avoids:** Pitfall 10 (config reload endpoint, env var interpolation).

### Phase Ordering Rationale

- Phases 1 -> 2 -> 3 -> 4 -> 5 -> 6 is the critical path.
- Phases 3 and 4 are architecturally independent and can be parallelized after Phase 2.
- Phase 5 is the riskiest phase -- needs more testing than others.
- Do NOT ship before Phase 5 completes (Pitfall 4 -- opacity causes rejection).

### Research Flags

Phases needing deeper research during planning:
- **Phase 4 (Sentiment Analysis):** False positive mitigation. Patterns need validation against real conversations.
- **Phase 5 (Auto-Switch):** Cooldown timing, threshold calibration, anti-flapping duration need empirical tuning.

Phases with standard patterns (skip research-phase):
- Phase 1 (Skeleton), Phase 2 (Core Proxy), Phase 3 (Format Translation), Phase 6 (Polish)

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions npm-verified (2026-05-11). Node 24.13.0 confirmed locally. |
| Features | MEDIUM/HIGH | 9router and LiteLLM features verified. Sentiment switching confirmed novel. |
| Architecture | HIGH | Verified against 9router and Portkey Gateway codebases. |
| Pitfalls | HIGH | Based on official API documentation and distributed systems literature. |

**Overall confidence:** HIGH

### Resolved Discrepancies

Two discrepancies between research files were reconciled:
1. **HTTP framework:** ARCHITECTURE proposed Express, STACK recommends Fastify with stronger analysis. Recommendation: Fastify.
2. **Config format:** ARCHITECTURE showed JSON, STACK recommends YAML + Zod. Recommendation: YAML.

### Gaps to Address

1. **Sentiment signal validation against real conversations.** Pattern set is domain-reasoned, not empirical.
2. **Upstream provider compatibility quirks.** Generic executor may need provider-specific tweaks.
3. **SSE client library compatibility.** Different parsers have varying strictness.
4. **Windows path handling.** Config discovery and file locking differ from Linux.

## Sources

### Primary (HIGH confidence)
- Fastify v5.8.5 npm registry verified (2026-04-14)
- TypeScript 6.0.3 npm registry verified (2026-04-16)
- @anthropic-ai/sdk v0.95.1, openai v6.37.0 npm registry verified (2026-05-07)
- conf v15.1.0, yaml v2.8.4, zod v4.4.3, pino v10.3.1 npm registry verified
- Node.js v24.13.0 verified on local environment
- Anthropic Messages API and OpenAI Chat Completions API documentation
- 9router source code (github.com/decolua/9router)
- Portkey Gateway source code (github.com/portkey-ai/gateway)

### Secondary (MEDIUM confidence)
- LiteLLM README -- feature comparison
- Kleppmann "Designing Data-Intensive Applications" (consistency and consensus)
- Sentiment analysis literature (Liu 2012, Mohammad 2021)

---
*Research completed: 2026-05-11*
*Ready for roadmap: yes*
