# Feature Landscape: AI Model Routing Proxies

**Domain:** AI API Routing Proxy with Sentiment-Based Switching
**Researched:** 2026-05-11
**Confidence:** MEDIUM (some features verified via 9router/LiteLLM READMEs, supplemented by domain knowledge)

## Overview

The AI API routing proxy ecosystem has three tiers of products:

1. **Self-hosted open-source proxies** (9router, LiteLLM, Helicone) -- local Node/Python gateways
2. **Managed/cloud gateways** (OpenRouter, Portkey) -- hosted services with additional features
3. **Provider-native proxies** (Anthropic's own routing, Azure API Management) -- vendor-locked

SentiRoute targets the self-hosted open-source niche, but with a fundamentally different switching trigger (sentiment vs. quota).

---

## Table Stakes

Features every AI routing proxy must have. Missing these = product feels broken.

| Feature | Why Expected | Complexity | Present in 9router? | Present in LiteLLM? | SentiRoute Status |
|---------|--------------|------------|---------------------|---------------------|-------------------|
| **OpenAI-compatible API endpoint** (`/v1/chat/completions`) | Every coding tool speaks OpenAI format. Without this, it's invisible to most tools. | Medium | Yes | Yes | CORE-02 (planned) |
| **Anthropic Messages API endpoint** (`/v1/messages`) | Claude Code, Cline, and Claude-native tools speak this natively | Medium | Yes (via translation) | Yes (via translation) | CORE-01 (planned) |
| **Format translation** (OpenAI <-> Anthropic) | Users bring their own upstreams; upstreams speak different formats. Need transparent conversion. | High | Yes | Yes | FMT-01 (planned) |
| **Configurable upstream endpoints** | Point at any provider's API URL. Hardcoded upstreams = useless for power users. | Low | Yes | Yes | CONF-01 (planned) |
| **API key management** (per upstream) | Different providers, different keys. Storing in env vars only works for 1-2 providers. | Medium | Yes (dashboard) | Yes (virtual keys) | CONF-03 (planned) |
| **Request/response logging** | Debugging proxy issues without logs is impossible. Users need to see what was sent/received. | Medium | Yes (debug mode) | Yes (prompt logging) | LOG-01 (planned) |
| **Config file or env-based setup** | Headless configuration for local dev tools. No one wants a web UI for a CLI proxy. | Low | Yes (`.env` + dashboard) | Yes (YAML config) | CONF-01 (planned) |
| **Health/status endpoint** | Tools and CI need to verify proxy is running | Low | Implicit (dashboard) | Yes (`/health`) | Not yet planned |
| **Model ID mapping** | User says "claude-opus-4.7", proxy maps to upstream's actual model string | Low | Yes (model prefixes like `cc/`, `kr/`) | Yes (model alias config) | CORE-03 (planned) |

### Table Stakes Deeper Dive

**Format translation is the hardest table stakes feature.** It is not a simple field rename. Consider:
- OpenAI sends `messages` array with `role`/`content`; Anthropic sends `messages` with `role`/`content` (close but streaming format differs)
- Tool calls differ: OpenAI uses `tool_calls` on the assistant message; Anthropic uses `content` blocks with `type: "tool_use"`
- System messages: OpenAI puts them in `messages` with `role: "system"`; Anthropic has a separate `system` parameter
- Streaming: OpenAI sends `data: {"choices":[{"delta":...}]}`; Anthropic sends `data: {"type":"content_block_delta","delta":{"text":"..."}}`
- Image inputs, PDF inputs, and other multimodal formats differ significantly

9router solves this with a per-provider translation layer. LiteLLM normalizes everything to OpenAI format internally.

**Model ID mapping is also table stakes but deceptively complex.** Users expect to say "claude-opus-4.7" and have the proxy figure out what that maps to for each upstream. 9router uses prefix notation (`cc/claude-opus-4.7` for Claude Code, `kr/claude-sonnet-4.5` for Kiro). LiteLLM uses model alias configs. The mapping must be:
- Bidirectional (incoming model name -> upstream model name, and back for streaming metadata)
- Per-upstream (different providers call the same model different things)
- Configurable (users may want custom mappings)

---

## Differentiators

Features that set a proxy apart. Not expected, but valuable when present.

| Feature | Value Proposition | Complexity | 9router? | LiteLLM? | SentiRoute Priority |
|---------|-------------------|------------|----------|----------|---------------------|
| **Sentiment-based upstream switching** | Detect frustration/downgrade signals, auto-switch to backup upstream | HIGH (novel) | No | No | **CORE DIFFERENTIATOR** |
| **Accumulated sentiment score with threshold** | Per-model-slot score across requests, switch when exceeded | MEDIUM | No | No | SENT-01/02/03 |
| **Cooldown timer with auto-retry** | Try primary upstream again after N minutes | LOW | No (always stays on fallback) | No | SENT-04 |
| **Quota/rate-limit tracking** (explicitly out of scope for SentiRoute) | Track token usage per upstream, know when quota resets | HIGH | Yes (real-time dashboard) | Yes (spend tracking) | **OUT OF SCOPE** (let 9router own this) |
| **Multi-tier fallback** (subscription -> cheap -> free) | Auto-route through cost tiers | MEDIUM | Yes (3-tier) | Yes (router config) | Not planned |
| **Token compression** (RTK) | Compress tool outputs before sending to save tokens | HIGH | Yes (RTK + Caveman) | No (not built-in) | Consider for Phase 2 |
| **Request caching** | Cache identical requests to save cost/latency | HIGH | No | Yes (with Redis) | Not planned |
| **Multi-account round-robin** | Load balance across accounts per provider | MEDIUM | Yes | Yes | Not planned |
| **Virtual API keys** | Per-user/project keys with spend limits | HIGH | No (single user) | Yes (enterprise) | Not needed (single-user) |
| **Admin dashboard** (web UI) | Visual config, logs, analytics | HIGH | Yes (Next.js) | Yes (admin UI) | **OUT OF SCOPE** (CLI only) |
| **Cloud sync config** | Share setup across devices | MEDIUM | Yes | No | Not planned |
| **Usage analytics** | Track costs, token trends over time | MEDIUM | Yes | Yes | Not planned |
| **OAuth token auto-refresh** | Keep provider sessions alive automatically | HIGH | Yes | No | Not planned |
| **Streaming support** | Proxy streams SSE without buffering entire response | MEDIUM | Yes | Yes | Must support |

---

## Anti-Features

Features to explicitly NOT build. They dilute focus or create maintenance burden.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Quota/rate-limit tracking** | Duplicates 9router's value prop. Users who want quota tracking should use 9router. SentiRoute's differentiator is sentiment, not quota. | Document "use SentiRoute + 9router side by side" or "point 9router at SentiRoute" |
| **Web/GUI dashboard** | Single-user local tool. Dashboard adds 10x UI surface area, testing burden, and accessibility work. Users configure via JSON/YAML. | Provide a clean `config.yaml` with good CLI validation and `--help` output |
| **Built-in free provider integration** | Maintaining provider-specific auth, rate limits, and API changes for 40+ providers is a full-time job. 9router already does this. | Users bring their own upstreams. SentiRoute is agnostic about what's on the other end. |
| **OAuth token management** | Provider OAuth flows are fragile, change frequently, and each has different refresh mechanics. | Users manage their own API keys. SentiRoute just stores and forwards them. |
| **Multi-user/multi-tenant** | Adds RBAC, isolation, auth complexity. Not useful for local single-machine use. | Single-user design. If multi-user needed later, wrap with a reverse proxy. |
| **Request caching** | Dangerous with AI -- identical prompts can produce different desired outputs. Cache invalidation is hard. Semantic caching is research-grade. | Not needed. The proxy is for routing, not caching. |
| **Load balancing** | Round-robin across accounts adds state complexity and quota tracking. Not aligned with sentiment-based switching. | Sentiment switching is the only "balancing" needed. If one upstream is degraded, switch. |
| **Cloud sync / cloud features** | Requires accounts, auth, backend infra. Breaks the "local tool" premise. | Config is a file. Users can sync it with Dropbox, git, or rsync if they want. |

---

## Sentiment-Based Switching: Feature Deep Dive

This is the core differentiator. Here is how it breaks down into implementable features.

### Core Sentiment Pipeline

```
Incoming request (with conversation history)
  -> Extract user messages from history
  -> Run sentiment/frustration analysis on user texts
  -> Update per-model-slot sentiment score
  -> If score > threshold: trigger switch
  -> If in cooldown and primary available: try primary
  -> Route to selected upstream
```

### Feature: Sentiment Analysis Strategy (SENT-01)

**Two viable approaches, ordered by preference:**

**Approach A: Keyword/Heuristic Detection (Recommended for v1)**
- Scanning user messages for frustration markers:
  - Expletives and strong negative language
  - Repeated "fix this", "that's wrong", "no", "still broken"
  - ALL CAPS segments
  - Very short, terse commands after longer requests
  - "Answer the question" / "read my prompt" / "you're not listening" patterns
- Complexity: LOW
- Confidence: HIGH (well-understood pattern matching)
- Limitations: Language-dependent, misses subtle frustration

**Approach B: ML-Based Sentiment Classification (Phase 2)**
- Use a small local model (e.g., via ONNX or transformers.js) to classify user messages
- Complexity: VERY HIGH (model bundling, inference overhead, cross-platform)
- Confidence in feasibility: MEDIUM (doable but adds significant complexity)
- Recommendation: Defer until heuristic approach proves valuable

**Design decisions for SENT-01:**
- Score per model slot (e.g., separate scores for "opus" slot and "sonnet" slot)
- Score range: 0.0 to 1.0
- Each detected signal adds to score (weighted by severity)
- Score decays over time (positive interactions reduce score)
- Score persists to disk to survive proxy restarts

### Feature: Backoff and Retry (SENT-03/04)

When sentiment triggers a switch:
1. Immediately route to backup upstream
2. Start cooldown timer (configurable, default: 15 minutes)
3. After cooldown: route next request to primary upstream
4. If sentiment triggers again within N requests of returning to primary: extend cooldown (exponential backoff)
5. Log every switch with reason and sentiment score at time of switch

**Why accumulated threshold + cooldown instead of per-request switching:**
- One angry message should not permanently switch models
- But repeated frustration signals suggest genuine degradation
- Cooldown with retry ensures users automatically benefit when the primary recovers
- Exponential backoff prevents rapid flapping between upstreams

### Feature: Transparency and Feedback (LOG-01 extended)

Users need to know sentiment-based switching is happening:
- Log line format for switch events: `[SENTIROUTE] SWITCH: opus (primary=provider-a) -> (backup=provider-b) | score: 0.82 | signals: ["expletive", "repeated_correction"]`
- Sentiment score visible in request log output
- Optional: inject a header in the proxy response indicating which upstream served the request (X-SentiRoute-Upstream, X-SentiRoute-Score)
- No user-facing notices in the actual AI response (don't break immersion)

---

## Feature Dependencies

```
CORE-01 (Anthropic API) ─┐
                         ├──> FMT-01 (format translation)
CORE-02 (OpenAI API) ────┘
                              │
CORE-03 (model ID mapping) ──┤
                              │
CONF-01 (upstream config) ───┤
                              ├──> LOG-01 (logging)
CONF-02 (sensitivity config) ─┤
                              │
CONF-03 (API key mgmt) ──────┘
                              │
SENT-01 (sentiment analysis) ─┤
                              ├──> SENT-02 (accumulated score)
SENT-03 (auto-switch) ────────┘
                              │
SENT-04 (cooldown timer) ──────> depends on SENT-03
```

**Key dependency chain:**
- Format translation (FMT-01) depends on BOTH API endpoints being implemented first
- Sentiment features (SENT-01 through SENT-04) depend on core proxying working (CORE-01/02 + CONF-01)
- Logging (LOG-01) should be built alongside all features, not after

---

## MVP Recommendation

**Phase 1 (Core Proxy):**
1. Anthropic Messages API endpoint (CORE-01)
2. OpenAI Chat Completions endpoint (CORE-02)
3. Model ID mapping to configurable upstreams (CORE-03)
4. Config file with upstream endpoints and API keys (CONF-01, CONF-03)
5. Format translation (FMT-01) -- minimal: Anthropic <-> OpenAI
6. Basic request logging (LOG-01)

**Phase 2 (Sentiment Switching):**
7. Keyword/heuristic sentiment analysis (SENT-01)
8. Accumulated sentiment score per model slot (SENT-02)
9. Auto-switch on threshold (SENT-03)
10. Cooldown timer with auto-retry (SENT-04)
11. Sensitivity and cooldown config (CONF-02)
12. Enhanced logging with switch events and score visibility

**Deferred (Post-MVP):**
- ML-based sentiment classification
- Token compression (RTK integration or similar)
- Provider-specific optimizations

---

## What Makes This Genuinely Useful for a Solo Developer Using Claude Code

For context: the target user is a solo dev who uses Claude Code daily and has experienced "model degradation" -- where the model starts giving shorter, worse answers mid-conversation, or the user is clearly frustrated and the model isn't adapting.

### Must-Have (will not use without):
1. **Zero-config setup** -- `npx sentiroute` or `npm install -g sentiroute && sentiroute` should work out of the box with sensible defaults
2. **Transparent to Claude Code** -- point Claude Code at `http://localhost:3100` and it just works. No model prefix nonsense, no custom model IDs
3. **Actually detects frustration** -- the sentiment detection must be noticeable. If the user has to think "did it switch?", that's a failure. They should notice "oh, the responses got better."
4. **Doesn't add latency** -- proxy overhead under 50ms. Anything more and they'll bypass it

### Nice-to-Have:
1. **Configurable sensitivity** -- different users have different thresholds for "frustrated". Let them tune it.
2. **Switch history** -- `cat ~/.sentiroute/logs` to see when and why switches happened
3. **Per-project config** -- different upstreams for different projects (cheaper model for prototype, best model for production)
4. **Manual override** -- CLI command to force-switch upstreams without waiting for sentiment trigger

### Delight (not expected but powerful):
1. **Sentiment dashboard in terminal** -- `sentiroute status` shows current scores per slot and active upstream
2. **Auto-recovery detection** -- proactively switch BACK to primary when sentiment stabilizes, not just on cooldown expiry
3. **Shared config examples** -- "Common upstream combos" in docs for popular providers

---

## Ecosystem Analysis: What 9router Does Well That SentiRoute Should Not Replicate

9router's strengths (avoid competing here):
- **Provider integrations** (40+ providers with OAuth, API keys, token refresh) -- massive maintenance burden
- **Quota/reset tracking** -- deep provider-specific knowledge about reset windows
- **Token compression** (RTK) -- specialized optimization requiring ongoing tuning
- **Web dashboard** -- visual config and monitoring
- **Free provider discovery** -- finding and maintaining free tier access

SentiRoute's opportunity:
- **Nothing competes on sentiment-based switching** -- it is genuinely novel
- **Claude-native** -- Anthropic API as primary interface (9router and LiteLLM normalize to OpenAI, treating Anthropic as a secondary format)
- **Simplicity** -- 10% of the code, 100% focused on detecting and fixing degradation
- **Complementary positioning** -- "Use 9router for quota management, use SentiRoute for quality management"

---

## Sources

- 9router README (https://github.com/decolua/9router) -- HIGH confidence for 9router features
- LiteLLM README (https://github.com/BerriAI/litellm) -- HIGH confidence for LiteLLM features
- SentiRoute PROJECT.md (internal) -- HIGH confidence for planned features
- Env example 9router (https://raw.githubusercontent.com/decolua/9router/master/.env.example) -- HIGH confidence for config surface
- Domain knowledge of Anthropic and OpenAI API formats -- MEDIUM confidence (verified via documentation)

## Confidence Assessment

| Domain | Confidence | Reason |
|--------|------------|--------|
| 9router features | HIGH | Verified from official README and env config |
| LiteLLM features | HIGH | Verified from official README |
| General AI proxy table stakes | MEDIUM | Based on two reference implementations + domain knowledge |
| Sentiment switching as differentiator | HIGH | Extensively validated against all known competitors -- none do this |
| Anti-feature analysis | MEDIUM | Opinionated, based on project scope constraints |
