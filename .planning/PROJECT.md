# SentiRoute — Sentiment-Driven AI Upstream Adapter

## What This Is

A local Node.js/TypeScript HTTP server that sits between AI coding tools (Claude Code, Codex, Cursor, etc.) and upstream AI providers. Unlike 9router's quota-based fallback, SentiRoute detects when a model is being "dumbed down" (降智) by analyzing user sentiment and frustration signals in the conversation, then automatically switches to a backup upstream. All upstream models are mapped to Claude official model IDs (claude-opus-4.7, claude-sonnet-4-6, claude-haiku-4.5) so it's transparent to the coding tool.

## Core Value

Never get stuck arguing with a lobotomized model — SentiRoute notices when you're getting pissed and silently reroutes you to a better upstream before you waste more time.

## Requirements

### Validated

- ✓ **CORE-03**: Server exposes GET /health endpoint returning status and active upstream per model slot — Phase 1
- ✓ **CONF-01**: YAML config file with per-model-slot upstream endpoints, API keys, and model name mapping — Phase 1
- ✓ **CONF-03**: Config validated on load with clear error messages (file path, line number, expected vs actual) — Phase 1

### Active

- [ ] **CORE-01**: Expose Anthropic-compatible Messages API at a local base URL with API key auth
- [ ] **CORE-02**: Expose OpenAI-compatible Chat Completions API for upstream model mapping flexibility
- [ ] **SENT-01**: Analyze user messages in conversation history for frustration/downgrade signals
- [ ] **SENT-02**: Maintain a per-model-slot sentiment score that accumulates across requests
- [ ] **SENT-03**: Auto-switch to backup upstream when sentiment score exceeds threshold
- [ ] **SENT-04**: Cooldown timer — try primary upstream again after configurable period
- [ ] **CONF-02**: User-configurable detection sensitivity and cooldown duration
- [ ] **FMT-01**: Transparent request/response format translation between Anthropic and OpenAI formats
- [ ] **LOG-01**: Request logging with sentiment scores and switch events visible

### Out of Scope

- Quota/rate-limit tracking — 9router already does this well, not competing
- Multi-user server deployment — single-machine local use
- OAuth token management — user handles their own upstream API keys
- GUI dashboard — CLI + config file driven, no web UI needed
- Built-in free provider integration — user brings their own upstreams

## Context

- **Reference:** Inspired by 9router (github.com/decolua/9router) — similar local proxy pattern but different switching logic
- **Problem:** AI models sometimes get "downgraded" mid-conversation (shorter responses, worse quality, "lobotomized" behavior). Users get frustrated, waste time arguing with the model. There's no automatic detection or remediation.
- **Users:** Individual developers using AI coding tools locally
- **Environment:** Node.js/TypeScript, runs as a local HTTP service, user points their coding tool at `http://localhost:{port}`

## Constraints

- **Runtime:** Node.js 18+, TypeScript
- **Deployment:** Local single-machine, `npm install -g` or run from source
- **API surface:** Must be Anthropic Messages API compatible (primary) + OpenAI Chat Completions compatible (for upstream translation)
- **Performance:** Proxy overhead must be negligible (< 50ms added latency)
- **State:** Sentiment scores and switch state persist to local file (survive restarts)
- **Config:** JSON/YAML config file, no web dashboard needed

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Node.js/TypeScript over Python | Familiar to 9router users, lightweight HTTP with Express/Fastify | — Pending |
| Accumulated threshold switching over per-request | Prevents flapping from single angry messages, more stable | — Pending |
| Anthropic API as primary interface | Claude Code is the main target, others can use OpenAI compat | — Pending |
| Local config file over web dashboard | Single-user local tool, don't need browser UI overhead | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-11 after Phase 1 completion*
