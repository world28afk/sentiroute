# Requirements: SentiRoute

**Defined:** 2026-05-11
**Core Value:** Never get stuck arguing with a lobotomized model — SentiRoute notices when you're getting pissed and silently reroutes you to a better upstream.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Core Proxy (CORE)

- [x] **CORE-01**: Server exposes Anthropic-compatible Messages API at POST /v1/messages with streaming SSE support
- [x] **CORE-02**: Server exposes OpenAI-compatible Chat Completions API at POST /v1/chat/completions with streaming SSE support
- [x] **CORE-03**: Server exposes GET /health endpoint returning status and active upstream per model slot
- [x] **CORE-04**: Model ID mapping — user-visible IDs (claude-opus-4.7, claude-sonnet-4-6, claude-haiku-4.5) resolve to configurable upstream model strings per slot
- [x] **CORE-05**: Upstream executor using native fetch with configurable timeouts, error passthrough (4xx/5xx), and streaming support

### Format Translation (FMT)

- [ ] **FMT-01**: Bidirectional Anthropic Messages ↔ OpenAI Chat Completions request translation
- [ ] **FMT-02**: SSE streaming response translation — per-stream state machines for content block lifecycle, tool call boundaries, stop reason mapping
- [ ] **FMT-03**: Reverse translation of responses back to original request format before returning to client

### Sentiment Detection (SENT)

- [ ] **SENT-01**: Analyze user messages in conversation history for frustration/downgrade signals using keyword/heuristic detection
- [ ] **SENT-02**: Maintain accumulated sentiment score per model slot (0.0–1.0 range, weighted signals, time decay)
- [ ] **SENT-03**: Auto-switch to backup upstream when per-slot sentiment score exceeds configurable threshold
- [ ] **SENT-04**: Cooldown timer — retry primary upstream after configurable period; exponential backoff on repeated triggers
- [ ] **SENT-05**: Anti-flapping lock — prevent rapid switching between primary and backup within a short window

### Configuration (CONF)

- [x] **CONF-01**: YAML config file with per-model-slot upstream endpoints (primary + backup), API keys, and model name mapping
- [ ] **CONF-02**: Configurable sentiment detection parameters (threshold, decay rate, signal weights, cooldown duration)
- [x] **CONF-03**: Config validated on load with clear error messages for invalid values
- [x] **CONF-04**: API key management — per-upstream API keys stored in config, forwarded in upstream requests

### Observability (OBS)

- [x] **OBS-01**: Structured JSONL request/response logging with request IDs, model slot, upstream used, latency, and sentiment score
- [ ] **OBS-02**: Switch event logging — visible log line on every upstream switch with reason and sentiment score at time of switch
- [x] **OBS-03**: X-SentiRoute-Upstream and X-SentiRoute-Score response headers indicating which upstream served the request
- [ ] **OBS-04**: CLI status command showing current scores per slot, active upstreams, and switch history

### State Management (STATE)

- [ ] **STATE-01**: Per-model-slot sentiment scores and switch state persisted to disk (survive restarts)
- [ ] **STATE-02**: Write-queued atomic file persistence — no corruption under concurrent requests
- [ ] **STATE-03**: Graceful shutdown — flush pending state writes before exit

### Dashboard (DASH)

- [x] **DASH-06**: Shared mutable ConfigManager class wrapping Config object for runtime config mutation by route handlers
- [x] **DASH-08**: API key masking utility -- recursive masking of api_key fields to first 2 + last 6 chars for safe API responses
- [ ] **DASH-09**: YAML config persistence -- write-back from in-memory Config to YAML file on disk

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Enhanced Detection

- **SENT-V2-01**: ML-based sentiment classification using local ONNX model — higher accuracy, language-agnostic
- **SENT-V2-02**: Proactive auto-recovery — switch back to primary when sentiment stabilizes (not just cooldown expiry)
- **SENT-V2-03**: Response quality analysis — detect short/terse responses, refusal patterns, content degradation

### Enhanced Routing

- **ROUTE-V2-01**: Multi-tier fallback chains (primary → backup → emergency) instead of single backup
- **ROUTE-V2-02**: Per-project config files — different upstreams for different working directories

### Tool Support

- **TOOL-V2-01**: Manual override CLI command (`sentiroute switch opus --to backup`) for forced switching
- **TOOL-V2-02**: Sentiment dashboard in terminal (`sentiroute status --watch`)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Quota/rate-limit tracking | 9router owns this niche. SentiRoute is quality management, not quota management. |
| Web/GUI dashboard | CLI-only tool for local single-machine use. Dashboard adds 10x UI surface area. |
| Built-in provider integrations | Users bring their own upstreams. No OAuth flows, no provider-specific code. |
| Multi-user / multi-tenant | Single-user local tool. No RBAC, no isolation. |
| Load balancing / round-robin | Sentiment switching is the only routing logic. No account rotation. |
| Request caching | Dangerous with AI — identical prompts need different outputs. Semantic caching is research-grade. |
| Token compression (RTK) | 9router already does this. Not competing on token economics. |
| Cloud sync | Local config file. Users sync however they want (git, Dropbox, rsync). |
| OAuth token management | Users manage their own API keys. No token refresh logic. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | Phase 2 | Complete |
| CORE-02 | Phase 2 | Complete |
| CORE-03 | Phase 1 | Complete |
| CORE-04 | Phase 2 | Complete |
| CORE-05 | Phase 2 | Complete |
| FMT-01 | Phase 3 | Pending |
| FMT-02 | Phase 3 | Pending |
| FMT-03 | Phase 3 | Pending |
| SENT-01 | Phase 4 | Pending |
| SENT-02 | Phase 4 | Pending |
| SENT-03 | Phase 5 | Pending |
| SENT-04 | Phase 5 | Pending |
| SENT-05 | Phase 5 | Pending |
| CONF-01 | Phase 1 | Complete |
| CONF-02 | Phase 4 | Pending |
| CONF-03 | Phase 1 | Complete |
| CONF-04 | Phase 2 | Complete |
| OBS-01 | Phase 2 | Complete |
| OBS-02 | Phase 5 | Pending |
| OBS-03 | Phase 2 | Complete |
| OBS-04 | Phase 5 | Pending |
| STATE-01 | Phase 4 | Pending |
| STATE-02 | Phase 4 | Pending |
| STATE-03 | Phase 4 | Pending |
| DASH-06 | Phase 6 | Complete |
| DASH-08 | Phase 6 | Complete |
| DASH-09 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 27 total (added DASH requirements)
- Complete: 12 (CORE-01 through CORE-05, CONF-01, CONF-03, CONF-04, OBS-01, OBS-03, DASH-06, DASH-08)
- Mapped to Phase 1: 3 (CORE-03, CONF-01, CONF-03) ✓ All complete
- Mapped to Phase 2: 7 (CORE-01, CORE-02, CORE-04, CORE-05, CONF-04, OBS-01, OBS-03) ✓ All complete
- Mapped to Phase 3: 3 (FMT-01, FMT-02, FMT-03)
- Mapped to Phase 4: 6 (SENT-01, SENT-02, CONF-02, STATE-01, STATE-02, STATE-03)
- Mapped to Phase 5: 5 (SENT-03, SENT-04, SENT-05, OBS-02, OBS-04)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-11*
*Last updated: 2026-05-11 after roadmap creation*
