# Architecture: SentiRoute -- Sentiment-Driven AI Upstream Adapter

**Domain:** AI API Proxy with Sentiment-Based Routing
**Researched:** 2026-05-11
**Confidence:** HIGH (verified against 9router and Portkey Gateway codebases)

## Executive Summary

SentiRoute needs a clean layered architecture separating concerns: HTTP serving, request routing, format translation, sentiment analysis, and upstream execution. The reference projects (9router, Portkey Gateway) both converge on the same pattern: a middleware-style pipeline where each request flows through detection, translation, routing, execution, and reverse-translation stages. Our architecture follows this proven pattern but adds a sentiment analysis layer that intercepts the flow at the routing stage.

## Recommended Architecture

```
                   ┌─────────────────────────────────────────────┐
                   │              HTTP Server Layer               │
                   │    (Express / Fastify on configurable port)   │
                   │                                              │
                   │  /v1/messages    /v1/chat/completions        │
                   └──────────────────────┬──────────────────────┘
                                          │
                                          ▼
                   ┌──────────────────────────────────────────────┐
                   │           API Auth Middleware                 │
                   │   Validates API key (simple token check)      │
                   └──────────────────────┬───────────────────────┘
                                          │
                                          ▼
                   ┌──────────────────────────────────────────────┐
                   │         Request Interceptor                  │
                   │   Extracts model ID, conversation messages   │
                   │   from request body                           │
                   └──────┬───────────────────┬──────────────────┘
                          │                   │
                          ▼                   ▼
              ┌───────────────────┐  ┌─────────────────────┐
              │   Format          │  │   Sentiment          │
              │   Detector        │  │   Analyzer           │
              │                   │  │                      │
              │  Detects if body  │  │  Scans conversation  │
              │  is Anthropic or  │  │  messages for user   │
              │  OpenAI format    │  │  frustration signals │
              └────────┬─────────┘  └──────────┬───────────┘
                       │                       │
                       │                       ▼
                       │              ┌─────────────────────┐
                       │              │   State Manager     │
                       │              │                     │
                       │              │  Accumulates score  │
                       │              │  per model slot     │
                       │              │  Threshold check →  │
                       │              │  triggers switch    │
                       │              └──────────┬──────────┘
                       │                         │
                       ▼                         ▼
              ┌──────────────────────────────────────────────┐
              │               Router Layer                    │
              │                                                │
              │  model ID (claude-sonnet-4-6) → slot config   │
              │  Resolves: upstream endpoint + auth           │
              │  Selects: primary OR backup (from state)      │
              │  Post-switch: exclude connection, start       │
              │  cooldown timer                                │
              └──────────────────────┬───────────────────────┘
                                     │
                                     ▼
              ┌──────────────────────────────────────────────┐
              │           Format Translator                   │
              │                                                │
              │  Anthropic Messages API ↔ OpenAI Chat API     │
              │  Translates request body to upstream format   │
              │  Translates response back to source format    │
              └──────────────────────┬───────────────────────┘
                                     │
                                     ▼
              ┌──────────────────────────────────────────────┐
              │            Upstream Executor                  │
              │                                                │
              │  Makes HTTP request to upstream provider      │
              │  Handles streaming (SSE) and non-streaming    │
              │  Handles HTTP errors, timeouts                │
              └──────────────────────┬───────────────────────┘
                                     │
                                     ▼
              ┌──────────────────────────────────────────────┐
              │           Response Pipeline                   │
              │                                                │
              │  Reverse-translate to source format           │
              │  Pipe streaming chunks through translator     │
              │  Log request/response + sentiment score       │
              └──────────────────────────────────────────────┘
```

## Component Boundaries

### 1. HTTP Server Layer

| Property | Decision |
|----------|----------|
| **Framework** | Express (simpler than Fastify for this scope; 9router uses Next.js which is overkill for a pure proxy) |
| **Port** | Configurable, default 8080 |
| **Routes** | `POST /v1/messages` (Anthropic), `POST /v1/chat/completions` (OpenAI), `GET /health` |
| **Body parsing** | JSON only; streaming handled via SSE passthrough |
| **Responsibility** | Parse request, delegate to pipeline, stream response back |

**Why Express over alternatives:**
- 9router's MITM server uses raw `https` module (too low-level for our needs)
- Portkey uses Hono (designed for Cloudflare Workers, not local Node.js)
- Express is the most widely understood, trivial to set up middleware chains for our pipeline
- If performance becomes a concern, drop-in replace with Fastify later (same middleware pattern)

### 2. API Auth Middleware

| Property | Decision |
|----------|----------|
| **Method** | Check `x-api-key` header (Anthropic convention) or `Authorization: Bearer <key>` (OpenAI convention) |
| **Storage** | Plaintext in config file |
| **Scope** | Global API key for the proxy itself (not upstream auth) |
| **Skip** | Allow empty key in config to disable auth |

Simple check: if config has an apiKey, validate incoming request has matching key. No user management, no scoping. Single-user tool.

### 3. Request Interceptor

Pulls structured data from the incoming request before forwarding:

```
Input: req.body (parsed JSON)
Output: {
  modelId: string,       // e.g. "claude-sonnet-4-6"
  messages: Message[],   // conversation history from body.messages or body.input
  sourceFormat: "anthropic" | "openai",
  stream: boolean,       // whether client expects SSE
  rawBody: object        // keep original for format translator
}
```

For Anthropic format: reads `body.model`, `body.messages`, `body.stream`, `body.system`.
For OpenAI format: reads `body.model`, `body.messages`, `body.stream`.

### 4. Sentiment Analyzer

**Input:** Array of user messages (role="user" in Anthropic, role="user" in OpenAI)
**Output:** SentimentScore { score: number, signals: Signal[], triggered: boolean }

Detection strategies (checked in order, OR logic):

| Signal | Pattern | Weight |
|--------|---------|--------|
| Explicit frustration | Message matches regex: `(this is (terrible|useless|wrong)|what are you talking about|you're not listening|are you even reading|you keep ignoring|worse than before|downgraded|lobotomized)` | +3 |
| Repetition | 3+ consecutive user messages with identical or near-identical content | +2 |
| Short retry | User sends 2+ messages under 20 chars in a row (`"no"`, `"wrong"`, `"read again"`) | +2 |
| Negation of previous | Message starts with `"no"`, `"not"`, `"still"` and is under 100 chars | +1 |
| Caps lock | >60% of alphabetic chars in a user message are uppercase | +1 |
| Rapid retry | 3+ user messages in last 5 turns (user:assistant pairs) | +1 |

Each model slot maintains its own score. Score accumulates (add weights, never reset on non-signal messages) and decays by 0.5 after each successful assistant response that doesn't trigger a signal.

**Threshold check:** When score >= threshold (default 5), emit SWITCH event and set state for that slot to BACKUP.

### 5. State Manager

Persistent state stored as local JSON file (survives restarts). In-memory cache for fast access.

```typescript
interface ModelSlotState {
  primaryEndpoint: string;
  backupEndpoint: string;
  
  // Sentiment
  sentimentScore: number;
  lastSignalTimestamps: number[];
  
  // Switch state
  activeEndpoint: "primary" | "backup";
  switchedAt: number | null;       // timestamp of last switch
  cooldownUntil: number | null;    // timestamp when can retry primary
  switchCount: number;             // total switches for this slot
  
  # Cooldown
  cooldownBaseMs: number;          // configurable, default 300000 (5 min)
  cooldownMultiplier: number;      // exponential backoff, default 2
  currentCooldownMs: number;       // grows with successive switches
}
```

State file path: `{dataDir}/state.json`

Operations:
- `getState(slotId)` -- returns current slot state (from memory, lazy-load file)
- `updateScore(slotId, delta)` -- adjusts score, returns current
- `triggerSwitch(slotId)` -- sets activeEndpoint=backup, starts cooldown
- `checkCooldown(slotId)` -- returns true if cooldown expired (should retry primary)
- `resetAfterRetry(slotId)` -- switches back to primary, halves cooldownMultiplier
- `persist()` -- writes state to disk (debounced, max every 5s)

**Why local JSON file instead of SQLite:**
- 9router uses SQLite (via sql.js) for complex relational data (providers, connections, aliases, settings). We have exactly one state shape per model slot -- a flat JSON object. SQLite adds build complexity (native bindings optional, sql.js adds 1MB+ bundle) for zero benefit.
- One model slot per user-visible model ID (claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5). At most 5-10 slots. JSON read/write is nanoseconds at this scale.
- Must handle concurrent writes: use a write lock (simple mutex) since Node.js is single-threaded. Debounce persistence to batch rapid updates.

### 6. Router Layer

The router is the brain of the system. It:

1. **Resolves model ID to slot config:** `claude-sonnet-4-6` -> lookup in config for `modelSlots["claude-sonnet-4-6"]`
2. **Consults state manager:** Is this slot on primary or backup?
3. **Checks cooldown:** If on backup and cooldown expired, switch back to primary
4. **Selects endpoint:** Returns resolved upstream URL + auth headers
5. **Post-switch actions:** If a switch just happened, log the event

```typescript
interface RoutedEndpoint {
  url: string;
  headers: Record<string, string>;
  format: "anthropic" | "openai";  // upstream format (for translation)
  isBackup: boolean;
  switched: boolean;                // true if this request caused a switch
}
```

### 7. Format Translator

Bidirectional translation between Anthropic Messages API and OpenAI Chat Completions API.

**Anthropic -> OpenAI (request):**
- `model` -> pass through (model slot already resolved the model name)
- `system` (string or array) -> prepend system message with role "system"
- `messages[]` -> convert content blocks:
  - `content: string` -> `content: string`
  - `content: [{type:"text",text:"..."}]` -> `content: [{type:"text",text:"..."}]`
  - `content: [{type:"tool_use",...}]` -> `tool_calls` format
  - `content: [{type:"tool_result",...}]` -> tool role message
- `max_tokens` -> `max_tokens`
- `temperature` -> `temperature`
- `tools[]` -> `tools[]` with function format
- `stream: true` -> `stream: true`

**OpenAI -> Anthropic (request):**
- `model` -> pass through
- `messages[]` -> extract system message(s) into top-level `system`
- `messages[]` -> convert roles:
  - `role: "system"` -> extracted (not in messages array)
  - `role: "user"` -> `role: "user"`, content as-is
  - `role: "assistant"` -> `role: "assistant"`, tool_calls -> tool_use blocks
  - `role: "tool"` -> `role: "user"` with tool_result blocks
- `tool_calls` -> tool_use content blocks
- `tool_call_id` -> tool_use id in tool_result
- `max_tokens` -> `max_tokens`
- `stream: true` -> `stream: true`

**Response translation (reverse):**

When upstream returns OpenAI format but client expects Anthropic:
- OpenAI chunk `choices[0].delta.content` -> Anthropic chunk `content[0].text`
- OpenAI `tool_calls` -> Anthropic `tool_use` blocks in `content` array
- OpenAI `finish_reason` -> Anthropic `stop_reason`

When upstream returns Anthropic format but client expects OpenAI:
- Anthropic chunk `content[0].text` -> OpenAI `choices[0].delta.content`
- Anthropic `tool_use` blocks -> OpenAI `tool_calls` in `delta`
- Anthropic `stop_reason` -> OpenAI `finish_reason`

**Implementation approach:** Separate translator modules per direction (mirroring 9router's `open-sse/translator/request/` and `open-sse/translator/response/`). Register translators in a central registry. The pipeline selects the translator pair based on source format and target format.

### 8. Upstream Executor

Makes the actual HTTP request to the upstream provider.

**Responsibilities:**
- Build URL from configured endpoint + API path (e.g., `https://api.upstream.com/v1/messages`)
- Set auth headers (API key, Bearer token, or custom headers from config)
- Handle streaming vs non-streaming:
  - Streaming: Pipe SSE chunks through response translator as they arrive
  - Non-streaming: Await full response, translate, return
- Error handling:
  - 4xx/5xx: Capture error body, return to client with appropriate status
  - Timeout: Return 504 Gateway Timeout
  - Network error: Return 502 Bad Gateway
- Timeout: Configurable per endpoint, default 120s for streaming, 60s for non-streaming

**Why not use 9router's executor pattern directly:**
9router has specialized executors per provider (AntigravityExecutor, GeminiCLIExecutor, etc.) because each provider has unique auth and URL schemes. For SentiRoute, the user configures upstreams explicitly with endpoint URL + auth, so a single generic HTTP executor suffices. We use the same `proxyAwareFetch` pattern but without per-provider specialization.

### 9. Config Manager

Reads configuration from a JSON file (default `config.json` in working directory or `{dataDir}/config.json`).

```typescript
interface SentiRouteConfig {
  // Server
  port: number;                           // default 8080
  host: string;                           // default "127.0.0.1"
  apiKey: string | null;                  // proxy auth, null = disabled
  
  // Model slots
  modelSlots: Record<string, ModelSlotConfig>;
  
  // Global defaults
  defaults: {
    sentimentThreshold: number;           // default 5
    cooldownBaseMs: number;               // default 300000
    cooldownMultiplier: number;           // default 2
    maxCooldownMs: number;                // default 3600000 (1 hour)
  };
  
  // State
  dataDir: string;                        // default "./data"
  stateFile: string;                      // default "state.json"
}

interface ModelSlotConfig {
  // User-visible model ID (key in modelSlots)
  primary: UpstreamConfig;
  backup: UpstreamConfig;
  sentimentThreshold?: number;            // per-slot override
  cooldownBaseMs?: number;                // per-slot override
}

interface UpstreamConfig {
  url: string;                            // e.g., "https://api.anthropic.com/v1"
  apiKey: string;
  format: "anthropic" | "openai";         // upstream API format
  timeoutMs?: number;
  headers?: Record<string, string>;       // extra headers
}
```

## Data Flow

### Request flow (streaming example, Anthropic client -> Anthropic upstream):

```
Client (Claude Code)
  │
  │ POST /v1/messages
  │ { model: "claude-sonnet-4-6", messages: [...], stream: true }
  │ x-api-key: <proxy-key>
  ▼
HTTP Server (Express)
  │
  │ 1. Parse JSON body
  │ 2. Auth check (x-api-key matches config.apiKey)
  ▼
Request Interceptor
  │
  │ modelId = "claude-sonnet-4-6"
  │ sourceFormat = "anthropic"
  │ messages = body.messages
  │ stream = true
  ▼
Sentiment Analyzer
  │
  │ Scan user messages for frustration signals
  │ Update score for slot "claude-sonnet-4-6"
  │ Score = 4 (below threshold of 5) → no switch
  │ Return: { score: 4, signals: ["negation_of_previous"], triggered: false }
  ▼
State Manager
  │
  │ persistScore("claude-sonnet-4-6", 4)
  │ slot is on PRIMARY (cooldown expired, or never switched)
  ▼
Router
  │
  │ modelSlots["claude-sonnet-4-6"].primary → upstream config
  │ Returns: { url: "https://upstream.example.com/v1/messages", format: "anthropic", isBackup: false }
  ▼
Format Translator
  │
  │ source="anthropic", target="anthropic" → no translation needed (passthrough)
  │ Return: body unchanged
  ▼
Upstream Executor
  │
  │ POST https://upstream.example.com/v1/messages  (with upstream API key)
  │ Headers: x-api-key, anthropic-version
  │ Body: same as incoming
  │
  │ ← SSE stream: event: message_start, content_block_delta, ...
  ▼
Response Pipeline
  │
  │ source="anthropic", target="anthropic" → passthrough
  │ Pipe SSE chunks directly to client
  ▼
Client (Claude Code)
  │ Receives SSE stream as if talking directly to Anthropic
```

### Request flow with sentiment switch (Anthropic client -> OpenAI backup):

```
Client (Claude Code)
  │
  │ POST /v1/messages
  │ { model: "claude-sonnet-4-6", messages: [user: "this is terrible, you keep ignoring me", ...] }
  │
  ▼
Sentiment Analyzer
  │
  │ Scan → matches "this is terrible", "you keep ignoring me"
  │ Score += 3 (explicit frustration) + 2 (repetition) = 5 → THRESHOLD EXCEEDED
  │ Return: { score: 5, signals: ["explicit_frustration", "repetition"], triggered: true }
  ▼
State Manager
  │
  │ setActiveEndpoint("claude-sonnet-4-6", "backup")
  │ setSwitchedAt(now)
  │ setCooldownUntil(now + 5min)
  │ incrementSwitchCount()
  │ persist()
  ▼
Router
  │
  │ State says BACKUP, returns backup endpoint config
  │ Returns: { url: "https://openai-upstream.example.com/v1/chat/completions",
  │            format: "openai", isBackup: true, switched: true }
  ▼
Format Translator
  │
  │ source="anthropic", target="openai"
  │ Anthropic → OpenAI request translation
  │ Return: translated body in OpenAI Chat Completions format
  ▼
Upstream Executor
  │
  │ POST https://openai-upstream.example.com/v1/chat/completions
  │ Body: { model: "gpt-4", messages: [...], stream: true }
  │
  │ ← SSE stream: choices[0].delta.content, ...
  ▼
Response Pipeline
  │
  │ source="anthropic", target="openai" (reverse direction for response)
  │ OpenAI SSE chunks → Anthropic SSE chunks
  │ Pipe translated chunks to client
  ▼
Client (Claude Code)
  │ Receives Anthropic-format SSE, unaware of format translation
```

### Cooldown flow:

```
Slot "claude-sonnet-4-6" is on BACKUP
  │
  │ Every request to this slot:
  │   State Manager.checkCooldown()
  │   → now > cooldownUntil? YES
  │   → Set activeEndpoint back to PRIMARY
  │   → Log: "Cooldown expired, retrying primary for claude-sonnet-4-6"
  │   → Route to primary
  │
  │ If primary succeeds:
  │   → Stay on primary
  │   → Halve cooldown multiplier (backoff relief)
  │
  │ If primary fails OR score exceeds threshold again:
  │   → Switch back to backup
  │   → Double cooldown duration (exponential backoff: 5min → 10min → 20min → ... → 1hr max)
```

## State Management Details

### State persistence

```
data/
├── config.json       # User configuration (manual edit)
├── state.json        # Runtime state (auto-managed)
└── logs/             # Request logs
    └── 2026-05-11.jsonl
```

### State JSON schema

```json
{
  "version": 1,
  "slots": {
    "claude-sonnet-4-6": {
      "sentimentScore": 4,
      "lastSignalTimestamps": [1747000000000],
      "activeEndpoint": "primary",
      "switchedAt": null,
      "cooldownUntil": null,
      "switchCount": 0,
      "currentCooldownMs": 300000
    },
    "claude-opus-4-7": {
      "sentimentScore": 7,
      "lastSignalTimestamps": [1747000001000, 1747000002000],
      "activeEndpoint": "backup",
      "switchedAt": 1747000002000,
      "cooldownUntil": 1747000302000,
      "switchCount": 2,
      "currentCooldownMs": 600000
    }
  },
  "lastSaved": 1747000003000
}
```

### Concurrency

Node.js event loop means no true concurrent access to state. The only concern is async interleaving:
- `getState()` followed by `await someAsyncOperation()` then `updateState()` -- state could change between read and write.
- **Mitigation:** Use a simple mutex (a promise chain queue) for write operations. Read operations are always safe since they access a shared in-memory object.

## Anti-Patterns to Avoid

### 1. Mixing sentiment analysis with format translation
**What:** Analyzing messages inside the translator module because "we already have the parsed body there."
**Why bad:** Translators should be pure functions. Sentiment analysis is an orthogonal concern that happens *before* routing, not during translation.
**Instead:** Run sentiment analysis in its own middleware step, before routing.

### 2. Per-request state file writes
**What:** Calling `fs.writeFileSync` on every request to persist the latest score change.
**Why bad:** Wastes I/O. State changes are frequent (every request), but only need persistence for crash recovery.
**Instead:** Debounce writes (batch changes, write every 5 seconds max). In-memory state is the source of truth; the file is a recovery checkpoint.

### 3. Streaming response buffering for translation
**What:** Collecting the entire SSE stream into memory, translating the full response, then sending to client.
**Why bad:** Defeats the purpose of streaming -- client has to wait for full response. For long responses, this adds seconds of latency.
**Instead:** Translate SSE chunks on-the-fly. Each `content_block_delta` or `choices[0].delta` chunk can be translated independently and forwarded immediately.

### 4. Global sentiment score (shared across model slots)
**What:** One score for the whole proxy, switching all models when threshold hit.
**Why bad:** A frustrating conversation with opus shouldn't switch your haiku model. Each model slot is independent.
**Instead:** Per-slot sentiment scores. Each slot has its own threshold, switch state, and cooldown.

### 5. Overly complex routing strategies
**What:** Implementing load balancing, weighted routing, latency-based routing, etc.
**Why bad:** SentiRoute is a sentiment-driven switch, not a general-purpose traffic router. 9router and Portkey handle those cases. We only need primary/backup with sentiment trigger.
**Instead:** Simple binary switch. Primary until sentiment threshold, then backup until cooldown expires. That's it.

## Build Order

The build order is determined by dependency graph. Each step produces testable output.

```
Phase 1: Skeleton + Config (no deps)
├── npm init, TypeScript setup, eslint
├── Express server with health endpoint
├── Config loader (JSON file read, validation)
└── Result: `npm start` boots a server on :8080, responds to /health

Phase 2: Routing + Proxy Core (depends on Phase 1)  
├── Model slot resolution (model ID -> upstream config)
├── Upstream executor (generic HTTP client with auth headers)
├── SSE passthrough (pipe raw stream through)
├── Primary-only routing (straight proxy, no switching)
└── Result: End-to-end proxy working. Claude Code can route through SentiRoute to upstream.

Phase 3: Format Translation (depends on Phase 2)
├── Anthropic <-> OpenAI request translator
├── Anthropic <-> OpenAI streaming response translator
├── Translator registry + selection logic
├── Integration: proxy now translates between formats
└── Result: Can route Anthropic client to OpenAI upstream and vice versa. Full format translation works.

Phase 4: Sentiment Analysis (depends on Phase 2, not 3)
├── Message extractor (pulls user messages from either format)
├── Signal detectors (regex, repetition, rapid retry, caps, negation)
├── Score accumulator and threshold check
└── Result: Sentiment scores computed per request, visible in logs.

Phase 5: State Management + Auto-Switch (depends on Phase 4)
├── State manager (in-memory + debounced JSON persistence)
├── Switch logic (trigger, cooldown, exponential backoff)
├── Cooldown check + automatic primary retry
├── Integration: Router consults state manager for endpoint selection
├── Standalone: state reset on score decay
└── Result: Full sentiment-driven switching works end-to-end.

Phase 6: Observability + Polish (depends on Phase 5)
├── Request logging (JSONL to file)
├── Sentiment score + switch events in logs
├── Configurable log levels
├── Graceful shutdown (save state on SIGTERM/SIGINT)
└── Result: Production-ready single-user tool.
```

**Key dependency insight:** Format translation (Phase 3) and Sentiment analysis (Phase 4) are independent -- neither depends on the other. They could be built in parallel if needed. However, Phase 3 (translation) should come first because it enables testing the proxy with both Anthropic and OpenAI tooling, which is the fastest way to validate the core value proposition.

**Critical path:** Phase 1 -> Phase 2 -> Phase 3 + Phase 4 -> Phase 5 -> Phase 6.

## Directory Structure

```
src/
├── index.ts              # Entry point: creates server, loads config, starts listening
├── config/
│   ├── loader.ts         # Read + validate config.json
│   ├── schema.ts         # TypeScript types for config
│   └── defaults.ts       # Default values
├── server/
│   ├── app.ts            # Express app setup, middleware registration
│   ├── routes/
│   │   ├── messages.ts   # POST /v1/messages handler
│   │   ├── chat.ts       # POST /v1/chat/completions handler
│   │   └── health.ts     # GET /health
│   └── middleware/
│       ├── auth.ts       # API key validation
│       └── logging.ts    # Request/response logging
├── proxy/
│   ├── router.ts         # Model slot resolution, endpoint selection
│   ├── executor.ts       # HTTP client for upstream calls
│   └── sse.ts            # SSE passthrough and chunk handling
├── sentiment/
│   ├── analyzer.ts       # Main analyzer: orchestrate detectors
│   ├── detectors/
│   │   ├── explicit.ts   # Explicit frustration keywords
│   │   ├── repetition.ts # Repeated identical messages
│   │   ├── short-retry.ts# Very short retry messages
│   │   ├── negation.ts   # Negation-prefixed messages
│   │   └── caps.ts       # All-caps messages
│   └── signals.ts        # Signal type definitions
├── translation/
│   ├── registry.ts       # Translator registration and lookup
│   ├── formats.ts        # Format identifiers and type guards
│   ├── request/
│   │   ├── anthropic-to-openai.ts
│   │   └── openai-to-anthropic.ts
│   └── response/
│       ├── anthropic-to-openai.ts
│       └── openai-to-anthropic.ts
├── state/
│   ├── manager.ts        # State read/write, persistence
│   ├── slot.ts           # Per-slot state operations
│   └── persistence.ts    # JSON file read/write with debounce
└── types/
    ├── messages.ts       # Anthropic + OpenAI message types
    ├── state.ts          # State types
    └── config.ts         # Config types (re-export from config/schema)
```

## Scalability Considerations

SentiRoute is a single-user local tool. Scalability beyond one user is out of scope. However, within that scope:

| Concern | At 1 user | Notes |
|---------|-----------|-------|
| Concurrent requests | Sequential (single conversation) | Express handles this fine |
| State file writes | < 1 write/sec | Debounced to every 5s |
| Memory | < 50 MB | Tiny state, no embedded models |
| CPU | Negligible | Regex on message text is trivial |
| File size | < 1 MB | State JSON stays small |

The only meaningful concern is SSE streaming memory for very long responses. Mitigation: don't buffer, pipe chunks directly.

## Sources

- 9router source code (github.com/decolua/9router): verified architecture via GitHub API -- MITM proxy layer (`src/mitm/`), SSE handler layer (`src/sse/`), format translator engine (`open-sse/translator/`), executor pattern (`open-sse/executors/`), SQLite state (`src/lib/db/`). HIGH confidence.
- Portkey Gateway source code (github.com/portkey-ai/gateway): verified architecture via GitHub API -- handler pattern (`src/handlers/`), middleware pipeline (`src/middlewares/`), provider adapters (`src/providers/`), services layer (`src/services/`). HIGH confidence.
- PROJECT.md: SentiRoute requirements and constraints. HIGH confidence.
