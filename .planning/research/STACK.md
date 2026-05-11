# Technology Stack: SentiRoute

**Project:** SentiRoute — Sentiment-Driven AI Upstream Adapter
**Researched:** 2026-05-11
**Overall confidence:** HIGH

## Recommended Stack

### Core Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Node.js | 18+ (target 20 LTS) | Runtime | Active LTS, built-in `fetch`, native fetch streaming, `http` module. We specifically target the fetch API + Web Streams API available from Node 18+. Verified: running Node 24.13.0 locally. |
| TypeScript | 6.0.3 | Language | Latest stable. TypeScript 6 ships with improved type inference, `const` type parameters, and faster compilation. dist-tag `latest` is 6.0.3 as of 2026-04-16. Do NOT pin to 5.x unless a breaking issue is found. TS 6.0 is the current stable line. |
| Fastify | 5.8.5 | HTTP server framework | Zero-overhead schema-based serialization, built-in body parsing, streaming support, plugin ecosystem. Most recent publish: 2026-04-14. TypeScript-first (ships `fastify.d.ts`). |

**Why Fastify over alternatives:**

- **Fastify vs Hono (v4.12.18):** Hono is web-standards-based and has zero dependencies, but the SentiRoute proxy needs 1) robust streaming with backpressure handling for SSE/chunked responses, 2) plugin architecture for future extensibility (auth middleware, rate limiting, observability), 3) schema-based serialization via `fast-json-stringify`. Hono's edge-compute focus buys nothing for a local Node.js server. Fastify's streaming is battle-tested at scale.

- **Fastify vs Express (v5.2.1):** Express 5 lost momentum — the ecosystem has shifted to Fastify for new projects. Fastify is 2-3x faster in JSON serialization (relevant for proxying 100K+ token responses), has better TypeScript DX, and avoids Express's callback-based middleware pitfall (error handling, async safety).

- **Fastify vs raw Node `http.createServer`:** Raw `http` is viable for a 2-route proxy (just `/v1/messages` and `/v1/chat/completions`). However, Fastify provides: 1) automatic JSON body parsing with error handling, 2) structured route definitions for testability, 3) streaming response pipeline via `reply.hijack()` or `reply.raw`, 4) schema validation that catches malformed requests early. The overhead is ~2MB installed — negligible for a CLI-installed tool.

### AI SDK Types (Type Definitions Only)

These are used for TypeScript types, NOT as HTTP clients. We write our own proxy requests.

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `@anthropic-ai/sdk` | 0.95.1 | Anthropic Messages API types | Official SDK, 2 dependencies (`standardwebhooks`, `json-schema-to-ts`), actively maintained (latest: 2026-05-07). We import types like `MessageCreateParams`, `Message`, `ContentBlock`, `StreamEvent`. |
| `openai` | 6.37.0 | OpenAI Chat Completions API types | Official SDK, ZERO dependencies, actively maintained (latest: 2026-05-07). We import types like `ChatCompletionCreateParams`, `ChatCompletion`, `ChatCompletionChunk`. |

**Important:** These are `dependencies` not `devDependencies` because they are runtime imports for type guards and type-narrowing in the format translation layer. The `openai` SDK has zero deps and `@anthropic-ai/sdk` has 2 — negligible cost.

### HTTP Client for Upstream Requests

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Node.js built-in `fetch` | (global, Node 18+) | Make upstream requests | No dependency. Available globally in Node 18+ (confirmed: Node 24.13.0). Supports streaming response bodies via `Response.body` (ReadableStream). Enables proxy streaming without buffering entire responses. |

**Why not a library:**
- **No axios:** Adds 400KB+ for what `fetch` does natively. Axios doesn't handle ReadableStream well for SSE passthrough.
- **No got/undici:** `fetch` wraps undici in Node 20+. Adding a separate HTTP client is redundant.
- **No node-fetch:** Deprecated since Node 18 made `fetch` global.

### Format Translation

| Component | Approach | Why |
|-----------|----------|-----|
| Anthropic --> OpenAI | Custom TypeScript transformers | No mature library exists for bidirectional conversion. The format mapping is straightforward: map `{role, content}` structure, handle tool-use blocks vs function-calling, translate SSE event schemas. Building custom avoids pulling in a general-purpose translation library (like Vercel AI SDK at 6.0.177) that would add hundreds of dependencies for features we don't use. |
| OpenAI --> Anthropic | Custom TypeScript transformers | Same rationale. The format translation is pure data mapping, not a "library problem." |

**Confidence: HIGH** -- the format translation is well-defined data transformation with clear spec on both sides (Anthropic Messages API docs, OpenAI Chat Completions API docs). No third-party dependency needed.

### Sentiment Analysis

| Component | Approach | Why |
|-----------|----------|-----|
| Frustration detection | Custom domain-specific keyword/phrase analysis | General NLP libraries (sentiment v5.0.2, last updated 2019; natural v8.1.1) are designed for general English sentiment ("good" vs "bad" on a -5 to +5 scale). Coding-tool frustration signals are domain-specific: profanity, imperatives, repetition signaling, comparison language ("dumber", "downgraded"), message length changes. A custom weighted-score approach with a JSON dictionary file gives: 1) zero external NLP dependencies, 2) domain-tuned accuracy, 3) user-extensible patterns. |

**Why NOT general sentiment libraries:**

| Library | Version | Status | Why Not |
|---------|---------|--------|---------|
| `sentiment` | 5.0.2 | Unmaintained since 2019 | 7 years stale. AFINN-165 word list is English-only, not coding-domain aware. |
| `natural` | 8.1.1 | Actively maintained | 15+ dependencies, includes 10 NLP features we don't need (stemming, POS tagging, WordNet, TF-IDF). Too heavy for a proxy where latency matters. |
| `@nlpjs/sentiment` | 5.0.0-alpha.5 | Alpha release | Not production-ready. Depends on full NLP.js pipeline. |
| `wink-nlp` | 2.4.0 | Lightweight | Still general-purpose NLP. Adds a pipeline architecture for no benefit. |

**Custom approach design (sketch for STACK context):**

```
frustration_signals.json
{
  "profanity": { "weight": 3.0, "patterns": ["fuck", "shit", "damn", "stupid"] },
  "imperatives": { "weight": 2.0, "patterns": ["just fix", "do it now", "stop being"] },
  "comparison_downgrade": { "weight": 4.0, "patterns": ["getting dumber", "downgraded", "lobotomized"] },
  "repetition": { "weight": 2.5, "patterns": ["again", "still not", "same problem"] },
  "message_shrinking": { "weight": 1.5, "signal": "decreasing_message_length_trend" }
}
```

Scores accumulate per model slot. When threshold exceeded, trigger switch.

**Confidence: HIGH** -- domain-specific signal detection is strictly better than general sentiment for this use case. The approach is well-understood (weighted keyword matching) and the dictionary can be user-configurable.

### State Persistence

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `conf` | 15.1.0 | Persistent JSON state store | Industry standard for CLI tools (used by yarn, npm under the hood). Provides: atomic file writes (no corruption on crash), dot-property access, platform-appropriate file location (`~/.config/sentiroute/state.json`), schema migration support. Most recent publish: 2026-02-04. |

**Why not raw JSON:**
- Race condition on concurrent writes (proxy handles multiple requests)
- No atomicity on crash (corrupted state file kills sentiment tracking)
- No platform-aware file locations
- No migration path for config format changes

**Why not a database:**
- Overkill for 3-5 model slots with single-digit KB of state
- SQLite would add 1MB+ for what a JSON file handles
- State schema: `{ [modelSlot]: { sentimentScore: number, currentUpstream: string, cooldownUntil: timestamp | null } }`

**State schema:**

```typescript
interface SentimentState {
  version: 1;
  slots: Record<string, {
    sentimentScore: number;      // accumulated, decays over time
    currentUpstream: 'primary' | 'backup';
    activeUpstreamId: string;    // which upstream config is active
    cooldownUntil: number | null; // epoch ms when cooldown expires
    lastSwitchAt: number | null;  // epoch ms of last switch event
  }>;
}
```

### Configuration

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `yaml` | 2.8.4 | Config file parsing | YAML is standard for developer tooling. Users edit a `sentiroute.yaml` or `sentiroute.yml`. Most recent publish: 2026-05-02. |
| `zod` | 4.4.3 | Config schema validation | TypeScript-first, infers static types from runtime schema. Gives users clear error messages on misconfiguration. Most recent: 2026-02 (v4 release). |

**Why this combo:**
- YAML for human editing (comments, multi-line strings for API keys if needed)
- Zod for schema validation with type inference (validates at load time, not runtime)
- `zod` v4 has improved error messages and smaller bundle than v3

**Why not `cosmiconfig`:** Adds complexity for config file searching. SentiRoute only needs `~/.config/sentiroute/config.yaml` or `./sentiroute.yaml` — not 10 search locations.

**Why not `env`-only:** Environment variables for API keys + YAML for everything else is the right split. But API keys are in the upstream config, not env vars, because users may have multiple upstreams.

### Logging

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `pino` | 10.3.1 | Structured JSON logging | Fastest JSON logger in Node.js. Ships TypeScript types (`pino.d.ts`). Structured logging enables piping to `pino-pretty` for human reading or to log aggregators. Most recent: 2026-02-09. |

**Why pino:**
- Proxy needs minimal overhead on each request — pino adds ~5% overhead vs console.log but gives structured output
- Request IDs, sentiment scores, switch events as structured fields
- Built-in log levels (info for requests, debug for format translations, warn for sentiment triggers)

**Why not `winston`:** Heavier, slower, more complex configuration. pino is sufficient for a single-machine local tool.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| HTTP server | Fastify 5.8.5 | Hono 4.12.18 | Hono's edge-compute focus provides no benefit for local Node.js. Fastify's plugin ecosystem and streaming tests are more mature. |
| HTTP server | Fastify 5.8.5 | Express 5.2.1 | Express 5 adoption stalled. Fastify is 3x faster on JSON serialization, has better TS DX. |
| HTTP server | Fastify 5.8.5 | Node `http.createServer` | Viable minimal option, but loses body parsing, schema validation, route structure, plugin extensibility. |
| Sentiment | Custom domain-specific | `sentiment` 5.0.2 | Unmaintained since 2019, general-purpose AFINN misses coding-domain signals. |
| Sentiment | Custom domain-specific | `natural` 8.1.1 | 15+ deps, too heavy for a latency-sensitive proxy. |
| State | `conf` 15.1.0 | Raw JSON `fs.writeFileSync` | No atomicity, no race condition safety, no platform paths. |
| State | `conf` 15.1.0 | `better-sqlite3` | Overkill for 3-5 model slots with single-digit KB state. |
| Config | `yaml` + `zod` | `cosmiconfig` | Unnecessary search complexity for a single-local-machine tool. |
| Config | `yaml` + `zod` | `env`-only | YAML needed for complex config (routing rules, multiple upstreams per slot). |
| Config | `yaml` + `zod` | `toml` | Less standard than YAML for developer CLI tools. |
| HTTP client | Native `fetch` | `axios` | Adds 400KB+ for what native fetch does. |

## Installation (project dependencies)

```bash
# Core runtime dependencies
npm install fastify@5.8.5
npm install @anthropic-ai/sdk@0.95.1
npm install openai@6.37.0
npm install conf@15.1.0
npm install yaml@2.8.4
npm install zod@4.4.3
npm install pino@10.3.1

# Dev dependencies
npm install -D typescript@6.0.3
npm install -D tsx@4.21.0
npm install -D vitest@4.1.5
npm install -D tsup@8.5.1
npm install -D @types/node@latest
```

## Dependency Tree Rationale

The goal is minimal dependencies for a latency-sensitive proxy. Each added dependency is justified:

```
Dependencies:
- fastify 5.8.5      → HTTP server (with ~14 transitive deps via its plugin architecture)
- @anthropic-ai/sdk   → Types only (2 transitive deps)
- openai              → Types only (0 transitive deps)
- conf 15.1.0         → State persistence (~3 transitive deps)
- yaml 2.8.4          → Config parsing (~0-1 transitive deps)
- zod 4.4.3           → Schema validation (~0 transitive deps)
- pino 10.3.1         → Logging (~2 transitive deps, pino is famously lean)

Total: ~20 transitive dependencies. Clean and auditable.
```

Compare to alternatives:
- Adding `natural`: +15 deps for no benefit
- Adding Vercel AI SDK (`ai`): +50+ deps for features we don't use
- Adding `winston`: +15 deps vs pino's 2

## Things NOT in the Stack

**Deliberate exclusions with rationale:**

| Technology | Why Excluded |
|-----------|--------------|
| Express.js | Adoption momentum has shifted to Fastify. Slower JSON serialization. Weaker TypeScript DX. |
| Hono | Excellent for edge compute. No benefit for a local Node.js proxy. Fewer plugins for proxy use cases. |
| Vercel AI SDK | Heavy general-purpose SDK (50+ deps). SentiRoute only needs format translation, not the full unified client. |
| Axios | Redundant with native `fetch`. No streaming response body support without workarounds. |
| Better-sqlite3 / SQLite | Overkill. State is <1KB per model slot. Native module compilation is a pain point for `npm install -g`. |
| Redis | No network service dependency for a single-machine tool. |
| Docker | Local tool, `npm install -g` is the distribution mechanism. Docker adds unnecessary complexity. |
| Swc / Esbuild (as TS compiler) | tsup handles bundling. tsx handles dev execution. No need for separate compilation tool. |
| Prisma / ORM | No database. State is JSON file. |
| Webpack / Vite | tsup is sufficient for bundling a Node.js CLI tool. |

## Sources

- Fastify v5.8.5: npm registry verified (published 2026-04-14, `fastify.d.ts` in package)
- TypeScript 6.0.3: npm registry verified (dist-tag `latest`, published 2026-04-16)
- `@anthropic-ai/sdk` v0.95.1: npm registry verified (published 2026-05-07, 2 deps)
- `openai` v6.37.0: npm registry verified (published 2026-05-07, 0 deps)
- `conf` v15.1.0: npm registry verified (published 2026-02-04)
- `yaml` v2.8.4: npm registry verified (published 2026-05-02)
- `zod` v4.4.3: npm registry verified
- `pino` v10.3.1: npm registry verified (published 2026-02-09, `pino.d.ts` in package)
- `sentiment` v5.0.2: npm registry verified (last updated 2019-08-22)
- `natural` v8.1.1: npm registry verified (updated 2026-02-27)
- Node.js v24.13.0: Verified on local environment

**Confidence assessment for all recommendations: HIGH** — all versions verified against npm registry on 2026-05-11.
