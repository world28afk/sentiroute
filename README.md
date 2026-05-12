<p align="center">
  <h1 align="center">SentiRoute</h1>
  <p align="center"><strong>Never argue with a lobotomized model again.</strong></p>
  <p align="center">
    <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js >=18">
  <img src="https://img.shields.io/badge/typescript-6.0-blue" alt="TypeScript 6.0">
  <img src="https://img.shields.io/badge/tests-535%20passed-success" alt="535 Tests Passed">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License">
</p>

---

SentiRoute is a **local HTTP proxy** that sits between your AI coding tools and upstream LLM providers. It analyzes the **emotional tone of your conversation** in real time. When it detects you're getting frustrated — swearing, repeating yourself, accusing the model of being "lobotomized" — it silently reroutes you to a backup upstream before you waste another token arguing with a degraded model.

Unlike [9router](https://github.com/decolua/9router.git) which switches on quota/balance, SentiRoute switches on **sentiment**. The proxy architecture is inspired by 9router's local upstream adapter design, and the SSE format translation draws from [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)'s streaming state machine approach. Same foundation, different routing philosophy.

## Sponsor

Thank you to **[RemixCodes](https://remix.codes/)** for sponsoring this project!

RemixCodes is a reliable and efficient API relay provider, offering unified API access to Claude and GPT models. 1:1 RMB-to-USD credit ratio, Claude as low as 0.5x, GPT-5.5 at 0.3x. No foreign cards, no geo-fencing.

## Quick Start

```bash
# Install globally
npm install -g sentiroute

# Start the proxy — auto-creates sentiroute.yaml with defaults on first run
sentiroute

# Configure your coding tool to use http://127.0.0.1:3000
```

On first run, SentiRoute creates `sentiroute.yaml` in the current directory with pre-configured model slots for Claude Opus, Sonnet, and Haiku — all pointing to Anthropic's API. Replace `sk-ant-your-key-here` with your real API key, or open the dashboard to configure everything in the browser.

You can also start from source:

```bash
git clone <repo-url> && cd sentiroute && npm install
npm run build && npm start
```

### Dashboard

Once the server is running, open **http://127.0.0.1:3000/dashboard/** for a browser-based config editor:

- **Config tab** — edit upstream endpoints, API keys, model mappings, proxy authentication
- **Sentiment tab** — per-slot score bars with live auto-refresh
- **History tab** — switch event timeline with timestamps and reasons
- **Runtime params** — sliders for threshold, decay rate, cooldown (hot-update, no restart)

## How It Works

```
┌──────────────┐     Anthropic SSE      ┌──────────────┐     native/translated    ┌──────────────┐
│  Claude Code │ ──── POST /v1/ ──────→ │  SentiRoute  │ ──── HTTP fetch ───────→ │   Upstream   │
│  Codex, etc  │ ←─── messages   ────── │  :3000       │ ←─── SSE stream ──────── │   Providers  │
└──────────────┘                        └──────┬───────┘                         └──────────────┘
                                               │
                                          ┌────▼────┐
                                          │  Sentiment  │  "this is fucking broken you dumb piece of garbage"
                                          │  Analyzer   │  ──→  score: 0.87  ──→  SWITCH to backup
                                          └────────────┘
```

Three subsystems work together on every request:

### 1. Sentiment Detection Engine

User messages are scored across **6 signal dimensions** using keyword/heuristic analysis:

| Signal | Weight | What It Detects |
|--------|--------|-----------------|
| **Degradation** | 0.9 | "降智", "dumb", "downgraded", "lobotomized", "nerfed" |
| **Profanity** | 0.8 | "fuck", "shit", "garbage", "trash", "useless" |
| **Repetition** | 0.6 | Same message sent 3+ times in a row (Jaccard similarity) |
| **Imperatives** | 0.4 | "stop", "don't", "wrong", "fix this", "不对", "错了" |
| **Capitalization** | 0.3 | Ratio of uppercase letters > 50% (shouting) |
| **Brevity** | 0.2 | Very short messages after long engaged ones (giving up) |

Weights are fully configurable. Scores accumulate with **exponential time decay** — if you calm down, the score naturally drops. New signals blend 70/30 with accumulated history for smooth transitions.

The analyzer supports both English and Chinese frustration signals natively — no NLP library dependency, no model overhead, zero added latency.

### 2. Auto-Switch Logic

```
Score > threshold (0.6) on primary?
  ├─ YES → switch to backup, start cooldown
  │        cooldown = base × 2^triggerCount (exponential backoff, max 1h)
  │        anti-flap lock prevents re-switch within 60s
  ├─ NO + on backup + cooldown expired?
  │        → switch back to primary ("sentiment recovered")
  └─ NO → stay put
```

When you have 3+ upstreams configured, the system escalates: primary → backup-1 → backup-2. Recovery always goes back to primary. Switch events are logged to console and persisted to disk.

### 3. Format Translation

SentiRoute translates between Anthropic Messages API and OpenAI Chat Completions API **bidirectionally** — including SSE streaming:

| Direction | Request | Response (non-streaming) | Streaming (SSE) |
|-----------|---------|--------------------------|-----------------|
| Anthropic → OpenAI | `system` → system message, `tool_use` → `tool_calls` | Content blocks → ChatCompletion | Per-event state machine (6 event types mapped) |
| OpenAI → Anthropic | System message → top-level `system`, `tool_calls` → `tool_use` | ChatCompletion → Content blocks | Per-chunk state machine (tool call index tracking) |

Translation only activates when the client format differs from the upstream format. Same-format requests pass through with zero overhead.

## Configuration Reference

Full `sentiroute.yaml` with all available options:

```yaml
server:
  host: '127.0.0.1'     # Bind address
  port: 3000             # Bind port
  # api_key: 'your-secret-key'  # Clients must provide this key to call the proxy. Remove or leave empty to disable.

model_slots:
  # Slot key = how you refer to this model in your coding tool
  opus:
    model: claude-opus-4-7       # Official model ID your tool sends
    upstreams:
      - name: Primary            # Human-readable name for logging
        endpoint: 'https://api.anthropic.com/v1'
        api_key: 'sk-ant-...'
        upstream_model: claude-opus-4-7   # Actual model to request
        format: anthropic                  # 'anthropic' or 'openai'
        timeoutMs: 120000                  # Default: 120000

      - name: Backup             # Switched to when sentiment triggers
        endpoint: 'https://api.openai.com/v1'
        api_key: 'sk-or-...'
        upstream_model: gpt-5
        format: openai

      # Add any number of backup upstreams
      - name: Emergency
        endpoint: 'https://alternative.api/v1'
        api_key: 'sk-...'
        upstream_model: claude-sonnet-4-6
        format: anthropic

  sonnet:
    model: claude-sonnet-4-6
    upstreams:
      # ... same structure

  haiku:
    model: claude-haiku-4.5
    upstreams:
      # ... same structure

# Optional: customize sentiment detection
sentiment:
  threshold: 0.6        # Score that triggers upstream switch (0.0–1.0)
  decayRate: 0.1         # Per-hour exponential decay of accumulated score
  cooldownMs: 300000     # Minimum time before retrying primary (ms, default: 5min)
  antiFlapMs: 60000      # Minimum time between any two switches (ms, default: 1min)
  weights:               # Per-signal weights (all optional, 0.0–1.0)
    degradation: 0.9
    profanity: 0.8
    repetition: 0.6
    imperatives: 0.4
    caps: 0.3
    brevity: 0.2
```

### Model ID Mapping

SentiRoute uses **fuzzy matching** for model IDs. Your coding tool can send `claude-haiku-4-5-20251001` (the full variant ID) and it matches the `haiku` slot. You never need to configure exact model strings — just use the human slot keys.

## CLI

```bash
# Start the server
sentiroute

# Show sentiment status for all slots
sentiroute status
```

Example `sentiroute status` output:

```
SentiRoute v0.1.0
Config: /home/user/.sentiroute/sentiroute.yaml

opus → claude-opus-4.7
  Score:       0.23 / 1.00  (threshold: 0.6)
  Upstream:    Primary  (#1 of 3)
  Cooldown:    none
  Triggers:    1
  History:
    2026-05-11 20:15:32  #0→#1  score:0.72  exceeded threshold
    2026-05-11 20:45:01  #1→#0  score:0.31  recovered

sonnet → claude-sonnet-4-6
  Score:       0.05 / 1.00  (threshold: 0.6)
  Upstream:    Primary  (#1 of 2)
  Cooldown:    none
  Triggers:    0
```

## API Endpoints

SentiRoute exposes a standard LLM proxy surface:

| Endpoint | Format | Description |
|----------|--------|-------------|
| `POST /v1/messages` | Anthropic Messages API | Primary endpoint for Claude Code, Cursor, etc. |
| `POST /v1/chat/completions` | OpenAI Chat Completions API | For OpenAI-format clients |
| `GET /health` | JSON | Uptime, config, active upstreams |

Both POST endpoints support **streaming (SSE)** and translate formats automatically when needed.

### Proxy Authentication

When `server.api_key` is set in `sentiroute.yaml`, all proxy endpoints (`/v1/messages`, `/v1/chat/completions`) require authentication. Clients must provide the key via:

- `Authorization: Bearer <key>` header, or
- `x-api-key: <key>` header

The `/health`, `/dashboard/`, and `/api/dashboard/` endpoints are exempt from authentication and remain publicly accessible.

If `server.api_key` is not set or empty, authentication is disabled (all requests pass through).

Response headers:

| Header | Value |
|--------|-------|
| `X-SentiRoute-Upstream` | Slot key of the model that served this request |
| `X-SentiRoute-Score` | Current sentiment score for this model (0.00–1.00) |

## Request Logging

Every request prints a clean one-line summary to stdout:

```
2026-05-11T20:15:32.123Z  POST /v1/messages  opus  Primary  200  2341ms
```

When a switch occurs, an additional line is printed:

```
2026-05-11T20:16:01.456Z  SWITCH  opus  sentiment threshold exceeded (score: 0.78, threshold: 0.60)
```

Structured JSONL logs are written to the config directory for programmatic consumption.

## Architecture

```
src/
├── config/           # YAML loading, Zod schema validation, path resolution
├── proxy/            # Model slot router, upstream HTTP executor (native fetch)
├── server/
│   ├── routes/       # Fastify route handlers (messages, chat, health)
│   └── middleware/   # Request logging (pino JSONL)
├── translation/      # Bidirectional Anthropic ↔ OpenAI format translation
│   ├── request/      # Request body translators
│   ├── response/     # Response + SSE streaming state machines
│   └── sse-parser.ts  # SSE line protocol parser
├── sentiment/        # Sentiment analysis and auto-switch
│   ├── signals.ts    # Keyword dictionaries, weighted scoring engine
│   ├── state.ts      # conf-based persistent state with write queue
│   └── switch.ts     # Switch decision logic (threshold, cooldown, anti-flap)
└── index.ts          # Entry point, CLI routing, graceful shutdown
```

### Key Design Decisions

**Zero NLP overhead.** The sentiment analyzer is a pure function operating on keyword dictionaries. No ONNX models, no natural language libraries, no GPU. A request passes through the analyzer in < 1ms.

**Provider-agnostic.** Every upstream is configured by URL, API key, and format. No built-in provider integrations. No OAuth flows. Bring your own keys.

**Conf for state persistence.** The `conf` library provides atomic writes and platform-appropriate file locations (`~/.config/sentiroute/` on Linux, `~/Library/Preferences/sentiroute/` on macOS). A serial write queue prevents corruption under concurrent requests.

**Full header passthrough.** Every client header (including `anthropic-beta`, `anthropic-dangerous-direct-browser-access`, etc.) is forwarded as-is to the upstream. Only auth headers are overridden with the configured API key. This prevents upstream providers from detecting the proxy.

## Development

```bash
git clone https://github.com/user/sentiroute.git
cd sentiroute
npm install

# Dev server with hot reload
npm run dev

# Type check
npm run typecheck

# Run tests
npm test

# Build for production
npm run build      # bundles with tsup → dist/
npm start          # runs dist/index.js
```

### Requirements

- Node.js >= 18 (tested on Node 24)
- TypeScript 6.0

### Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| HTTP server | Fastify 5 | 3x faster JSON serialization than Express, first-class streaming |
| HTTP client | Native `fetch` | Zero deps, ReadableStream support, built into Node 18+ |
| Config | YAML + Zod 4 | Human-editable config, runtime type inference, clear error messages |
| Logging | Pino 10 | Fastest JSON logger in Node, structured output |
| State | Conf 15 | Atomic writes, platform paths, no database needed |
| Testing | Vitest 4 | Native ESM, TS source support, fast |

## Comparison

| Feature | SentiRoute | 9router |
|---------|------------|---------|
| Routing trigger | User sentiment / frustration | Quota / balance exhaustion |
| Detection method | Keyword heuristic (zero latency) | Token counting |
| Switch behavior | Sentiment threshold + cooldown + backoff | Balance-based fallback |
| Format translation | Bidirectional Anthropic ↔ OpenAI + SSE | Anthropic ↔ OpenAI |
| State persistence | Atomic JSON (conf) | JSON file |
| Upstreams per slot | Unlimited with human names | Primary + backup |

SentiRoute is built on the same proxy architecture as 9router but swaps the routing engine from quota-based to sentiment-based. If your primary concern is model quality degradation rather than token budgets, SentiRoute is the tool.

## Acknowledgments

This project stands on the shoulders of three excellent projects:

- **[9router](https://github.com/decolua/9router.git)** — The original local upstream adapter that pioneered the proxy architecture SentiRoute is built on. 9router handles quota-based fallback across multiple API providers. SentiRoute adopts its config-driven model slot design, header passthrough strategy, and upstream execution model, replacing the routing engine with sentiment-driven switching.

- **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** — A Go-based proxy with production-grade bidirectional Anthropic ↔ OpenAI format translation. CLIProxyAPI's SSE streaming state machine patterns for content block lifecycle translation were the direct reference for SentiRoute's TypeScript streaming translators. The event mapping logic (content_block_start/stop/delta → OpenAI chunks, tool call index tracking) is adapted from CLIProxyAPI's approach.

- **[GSD (Get Shit Done)](https://github.com/gsd-build/get-shit-done/)** — A structured software development workflow for AI-assisted coding. SentiRoute's entire development lifecycle — requirements gathering, phase planning, architecture design, execution, and verification — was managed through GSD's phase-based workflow system with integrated research, planning, and quality verification gates.

## Community

- [LinuxDO](https://linux.do)

## License

MIT
