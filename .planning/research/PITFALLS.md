# Domain Pitfalls: Sentiment-Driven AI Upstream Proxy

**Domain:** AI API routing proxy with sentiment-based upstream switching
**Researched:** 2026-05-11
**Overall confidence:** HIGH (based on well-documented API specifications and common distributed systems patterns)

---

## Critical Pitfalls

Mistakes that cause silent failures, data corruption, or complete unusability.

### Pitfall 1: Streaming SSE Format Translation Produces Malformed Output

**What goes wrong:** When translating between Anthropic Messages API streaming format and OpenAI Chat Completions streaming format (or vice versa), subtle structural differences produce malformed SSE streams that the downstream client cannot parse, causing messages to silently truncate, tool calls to be dropped, or the client to throw parsing errors.

**Why it happens:** The two APIs have fundamentally different streaming event models:

- **Anthropic** uses a multi-event structure per content block: `message_start` -> `content_block_start` -> `content_block_delta` (repeated) -> `content_block_stop` -> `message_delta` -> `message_stop`. Each content block (text, tool_use) gets its own full lifecycle. The `type` field is top-level in each SSE event.
- **OpenAI** uses a flat delta structure per stream chunk: `choices[0].delta` with either `{ content: "..." }` or `{ tool_calls: [...] }`. There is no content-block lifecycle -- the `finish_reason` on `choices[0]` signals the end.

**Specific translation traps:**

1. **Tool call boundary mismatches.** Anthropic sends tool_use as a separate content block with a full `content_block_start` event containing `id`, `name`, and `input` (initially empty). The actual tool input arrives via `content_block_delta` with `partial_json`. OpenAI sends tool calls inside `delta.tool_calls[0]` with `function.arguments` accumulating. Mapping one to the other requires buffering the entire tool input before emitting -- which defeats streaming for tool calls.

2. **Content index desynchronization.** Anthropic assigns a numeric `index` to each content block. OpenAI does not. When translating Anthropic -> OpenAI, the proxy must flatten content blocks into sequential delta chunks. If a content block is empty or a tool call is rejected mid-stream, the index sequence can become misaligned, causing the client to attribute a text block's content to a tool block.

3. **Stop reason mapping is lossy.** Anthropic uses `stop_reason` values: `"end_turn"`, `"max_tokens"`, `"stop_sequence"`, `"tool_use"`. OpenAI uses `finish_reason`: `"stop"`, `"length"`, `"tool_calls"`, `"content_filter"`. The mapping `"end_turn"` -> `"stop"` is straightforward, but `"tool_use"` -> `"tool_calls"` requires the proxy to know whether it already emitted tool call chunks. Missing this mapping causes the client to think the response was truncated.

4. **Ping events are silently tangled.** Anthropic sends periodic `ping` events to keep connections alive. OpenAI does not. A naive proxy that forwards all SSE events without filtering `ping` will cause OpenAI client parsers to choke on unknown event types.

5. **Rate limit header translation.** Anthropic returns rate limit info in the response body (`anthropic-ratelimit-*` headers + `usage` in `message_start`/`message_delta`). OpenAI puts rate limits in HTTP headers. Proxies that forward raw response bodies will pass Anthropic-formatted usage data through an OpenAI-shaped response, confusing client libraries that expect `usage` at the top level.

**Consequences:** Silent message corruption, dropped tool calls, client-side parsing errors that manifest as "connection closed unexpectedly" or "failed to parse response," making the proxy appear unreliable when it's actually a format bug.

**Prevention:**
- Write an SSE event-by-event transducer, not a buffered message converter. Each incoming Anthropic event maps to zero, one, or multiple OpenAI events (and vice versa). Do NOT buffer the entire response and reformat it -- that defeats streaming.
- Use a state machine per-stream that tracks the current content block index, whether we are inside a tool call, and whether we have emitted a finish_reason yet.
- Maintain a bidirectional mapping table for stop reasons, and always flush any pending tool call buffer before emitting finish_reason.
- Explicitly filter or passthrough `ping` events depending on target format (strip ping for OpenAI output, inject ping for Anthropic output if forwarding to an Anthropic client).
- Never forward raw `usage` data through format boundaries. Reconstruct usage in the target format or omit it.

**Detection:**
- Add a test suite that sends realistic multi-turn conversations with tool calls through every format translation path and validates the output parses correctly on the receiving end.
- Instrument the proxy to log the number of SSE events consumed vs. produced per request. A mismatch > 2x indicates translation logic issues.
- Test with Claude Code and Cursor simultaneously -- they use different client libraries with different parsing strictness.

**Phase mapping:** Phase 3 (Format Translation). Must be designed before any production traffic hits the proxy.

---

### Pitfall 2: Sentiment Analysis False Positives on Frustration-Like Technical Language

**What goes wrong:** The proxy switches to the backup upstream because it misinterprets normal debugging language ("this is broken", "why does this fail", "stupid error at line 42", "what the hell is this doing") as user frustration with the model, when the user is actually just describing a technical problem. The result is an unnecessary upstream switch that might give them a worse model or break the conversation flow.

**Why it happens:** Technical conversations are filled with words that any sentiment lexicon would classify as negative: "broken", "fail", "error", "crash", "wrong", "bug", "stupid", "hate". These are domain vocabulary, not sentiment signals. The SentiRoute user is an AI coding tool user -- they spend all day writing messages like "this code is broken" and "why is this not working" at their AI tool. Nearly all their messages will contain frustration-adjacent language directed at their CODE, not at the MODEL.

**Specific failure modes:**

1. **Lexicon-based detection is useless.** Any bag-of-words or keyword-spotting approach will have >80% false positive rate on technical conversations because negative words describe the domain, not the model. A simple regex for "wtf|stupid|broken|fail|hate" will trigger on almost every debugging exchange.

2. **Zero-shot sentiment classifiers are biased.** Models like DistilBERT or cardiffnlp/twitter-roberta-base-sentiment were trained on social media or product reviews. They classify "this is absolute garbage" as negative -- but that is a normal developer utterance about a library, not about the model. Using them without domain adaptation produces systematic false positives.

3. **Context window truncation erases the target.** The sentiment analysis needs to distinguish "the MODEL response is bad" from "the CODE is bad" from "I am having a bad day." Without a clear reference anchor (analyzing the message *in reaction to the preceding model response*), the model cannot disambiguate. Sliding window analysis that only looks at the user's latest 1-2 messages loses the conversational context needed to judge what the frustration is directed at.

4. **Sarcasm and hyperbole are invisible** in short messages. "Oh great, another brilliant response from my favorite AI" registers as positive to naive classifiers. Single expletive messages ("fuck this") are ambiguous -- could be at code, at the model, or at a build system.

5. **Accumulated score drift.** Even if per-message scores are small errors, the accumulated threshold model means these errors compound. After 10-15 messages in a debugging session, the accumulated score will inevitably cross even a conservative threshold.

**Prevention:**
- **Do NOT use generic sentiment models.** They will fail catastrophically. Instead, design a simple heuristic: the signal is "user is complaining about the MODEL's output specifically." This means analyzing the pair (user message, preceding model response) for contradictions, corrections, or dismissals of the model's work.
- Use a narrow signal: track ratio of user message length to model response length. A user who suddenly writes very long, detailed corrections after getting short model responses is a stronger signal than keyword matches.
- Track explicit model criticism patterns: "that's wrong", "no, that's not right", "you ignored", "that doesn't address", "try again", "read the instructions". These specifically target the model, not the code.
- Implement a **sensitivity calibration mode** that logs what would have triggered without actually switching, letting users tune thresholds against their actual conversation history.
- Use a **dual-threshold** system: a low "flag for review" threshold that logs warnings, and a high "actually switch" threshold that requires sustained negative signals. The gap between them prevents single-message false positives.
- Add negative feedback: if the user immediately switches back to the primary upstream after an automatic switch, count that as a false positive and automatically raise the threshold.

**Detection:**
- Ship with logging-only mode first (CORE-01 and CORE-02 working, sentiment logging but no switching). Let users review logs against their real conversations to calibrate.
- Add a `--dry-run` flag that prints "would have switched" messages without actually switching.
- Instrument a "false switch rate" metric in logs -- how often does user manually switch back within 10 minutes of an automatic switch?

**Phase mapping:** Phase 4 (Sentiment Analysis Core). Must be designed alongside Phase 2 (Core Proxy) to ensure the hook points exist. Calibration should happen in Phase 5 (Calibration + Polish).

---

### Pitfall 3: State File Corruption Under Concurrent Requests

**What goes wrong:** When multiple AI coding tools (e.g., Claude Code + Cursor simultaneously) send requests through the proxy, concurrent reads and writes to the sentiment score state file produce corrupted data -- scores reset to zero, switch state disappears, or the file contains interleaved JSON fragments. Users lose their sentiment history across tools and the proxy never switches.

**Why it happens:** The simplest persistence approach -- reading the entire JSON file into memory, modifying it, writing it back -- has a race condition window. Two concurrent requests both read the file (both see score=5), both increment (+1 each), both write back (both write score=6). The expected score=7, but one increment is lost. Under many concurrent requests (common with agentic tools that send parallel requests), this happens constantly.

**Specific failure modes:**

1. **Read-modify-write race.** The classic race condition described above. Under load, accumulated scores drift arbitrarily below their true value. The proxy never switches because the file keeps losing increments.

2. **Partial write corruption.** If the proxy crashes in the middle of `writeFileSync` (or `writeFile` without atomic write), the state file contains truncated JSON. On restart, `JSON.parse` fails, and if the code defaults to `{}`, all sentiment history is lost. Users are back to zero.

3. **File locking is platform-dependent.** `fs.lock` or advisory locks work differently on Windows (mandatory locking on open files) vs. Linux (advisory only). A solution tested only on Linux will silently fail on Windows by not actually preventing concurrent writes.

4. **Timer-request interaction.** The cooldown timer (CORE-04) fires and resets switch state at the same moment a request is writing an updated score. The final state depends on which write happens last, creating non-deterministic behavior where switches sometimes happen and sometimes don't.

5. **Sentiment state for different model slots is interdependent.** If the state file stores scores for claude-opus-4.7, claude-sonnet-4-6, and claude-haiku-4.5 in the same file, a write from an opus request can overwrite sonnet data that was updated concurrently. The model slots unintentionally corrupt each other.

**Prevention:**
- **Use a write queue, not direct file writes.** All state mutations go through a single asynchronous queue (a simple array of (mutationFn, callback) pairs processed sequentially). This eliminates concurrent write races without needing file locking.
- **Write atomically.** Use `writeFileSync` with a temp file + rename pattern, or use `fs.promises.writeFile` combined with a mutex. On Node.js 18+, write to a `.tmp` file, then `rename` it over the target. Rename is atomic on both Linux and Windows (same filesystem).
- **Debounce persistence.** Do not write on every request. Collect state changes in memory, persist at most once per 1-2 seconds. More frequent writes increase contention with no benefit since the file is only read at startup and after crashes.
- **Separate state per model slot.** Use separate files (`state-opus.json`, `state-sonnet.json`, `state-haiku.json`) or a single file with a write lock. Separate files are simpler and prevent slot cross-contamination.
- **Use process-level not request-level cooldown.** Cooldown timers should be managed in-memory via a single timer per model slot, not spawned per request. Cancel stale timers when state changes.
- **Validate on read.** On startup, validate the state file with JSON Schema. If invalid, log a warning and start fresh rather than crashing or using corrupted data. But also log the old corrupted file for debugging.
- **Always write then read-back to verify** when the file is small (it will be). If the read-back doesn't match, retry.

**Detection:**
- Add an integrity check: each state entry has a monotonically increasing `version` number. If the expected version doesn't match on write, a race occurred -- log it.
- Instrument a counter of "write conflicts detected per minute" and surface it in log output.
- Load test with 10+ concurrent requests hitting different model slots simultaneously and verify state file integrity after each batch.

**Phase mapping:** Phase 2 (Core Proxy -- HTTP server + state file). Must be designed correctly from the start because retrofitting atomicity into state management after bugs appear is painful.

---

### Pitfall 4: Proxy Opacity Makes Users Distrust or Abandon the Tool

**What goes wrong:** The proxy silently switches upstreams, or silently fails to switch, and the user has no visibility into what happened. They either blame the model ("this upstream sucks") or blame the proxy ("this tool is broken"). Either way, they stop using it. The proxy's core value proposition (automated switching) is invisible when it works and confusing when it doesn't.

**Why it happens:** Local proxy tools (including 9router) face an inherent UX challenge: the user configured it, pointed their tool at it, and then forgets it exists. Any behavior that differs from a direct connection is surprising. The proxy's job is to be invisible when things are fine and informative when things change -- but most implementations err toward total silence and assume the user can check logs.

**Specific failure modes:**

1. **Silent switch with no notification.** The proxy switches from primary to backup upstream. The user continues chatting. The model behavior changes (different provider, different model quality). The user thinks they broke something or the model degraded further. They restart their tool, which resets the connection. The proxy switches back to primary. The user never knows what happened.

2. **"Why is it slow?" confusion.** Sentiment analysis adds latency (the proxy must receive the user's message, run analysis, then forward). Even 50-100ms of added latency is noticeable as "laggy" typing. Without clear instrumentation, the user blames the upstream or their network.

3. **Log spam.** Every request gets logged with full sentiment scores, internal state dumps, and debug info. The signal (actual switch events) is buried in noise. Users stop checking logs entirely.

4. **Configuration errors are invisible.** If the YAML config has a typo in the upstream URL, the proxy starts but all requests to that upstream fail with 502/503. The user sees "connection error" in their coding tool and assumes the proxy itself is broken, not their config.

5. **Switch thrashing.** If the accumulated sentiment score hovers near the threshold, the proxy switches back and forth rapidly (primary -> backup -> primary -> backup). Each switch causes a brief connection interruption. The user experiences a stuttering conversation. This is the proxy equivalent of page-flapping in load balancers.

6. **Cooldown timer feels arbitrary.** The proxy switches to backup, then after 5 minutes switches back to primary. The user's conversation is interrupted again. They don't understand why it switched back -- the model is still "dumb" in their perception. The cooldown mechanism is opaque.

**Prevention:**
- **Every switch event MUST produce a user-visible notification.** At minimum, add an `X-SentiRoute-Switch: primary->backup` header to API responses (the coding tool won't show it, but it's inspectable). Better: log to a dedicated terminal output with a clear format like `[SentiRoute] Switched opus: primary (OpenRouter) -> backup (Direct API) | reason: sentiment score 8/10 (6 negative signals in last 15 messages)`. The user can `tail -f` the proxy log.
- **Provide a health/status endpoint.** `GET /status` returns current routing state per model slot: active upstream, sentiment score, total requests, switch history. The user can curl it to check what's happening.
- **Log levels must be strict.** `info` for switch events and errors only. `debug` for per-request sentiment scores and state dumps. Default to `info`. The user opts into noise.
- **Config validation on startup.** Load the config, validate all upstream URLs are reachable (HTTP HEAD /health), validate API key format, and print a clear startup summary:
  ```
  SentiRoute v0.1.0
  Listening on http://localhost:3001
  Model slots:
    claude-opus-4.7: primary=OpenRouter ✓ | backup=Direct API ⚠ (no backup configured)
    claude-sonnet-4-6: primary=OpenRouter ✓ | backup=None
  Sentiment sensitivity: medium (threshold 7/10)
  ```
- **Anti-flapping.** Once a switch occurs, lock the routing decision for at least N requests or M minutes, regardless of score fluctuations. Only re-evaluate after the lock period expires. This prevents rapid oscillation.
- **Cooldown should be user-configurable with a good default** (15 minutes, not 5). Display remaining cooldown in the status endpoint.
- **Manual override must exist.** Add `POST /switch/{model-slot}/{upstream-name}` to let the user force a switch. If the user manually overrides, respect that over automatic logic. This gives the user agency and builds trust.

**Detection:**
- Before shipping, have 3 developers use the proxy for a day and interview them about moments of confusion or surprise. The feedback will be overwhelmingly about opacity.
- Add telemetry (local-only, opt-in) that records "switch events followed by user-manual-revert within 10 minutes" as a UX failure signal.

**Phase mapping:** Phase 2 (Core Proxy) must include logging infrastructure. Phase 5 (Calibration + Polish) should add the status endpoint and notification system. Do NOT ship to users before Phase 5 -- the opacity alone will cause rejection.

---

## Moderate Pitfalls

### Pitfall 5: Request Identity Leaks Across Format Translation

**What goes wrong:** When reformatting requests from Anthropic format to OpenAI format (or vice versa), fields that exist in one format but not the other get silently dropped, causing subtle behavioral differences. System prompts get lost, metadata fields vanish, and streaming options behave unexpectedly.

**Why it happens:** The Anthropic Messages API has features without OpenAI equivalents: `metadata` (user_id, client tools), specific content block types (e.g., `image` with embedded base64), `tool_choice` with `type: "any"` or `type: "tool"`, and `thinking` blocks. OpenAI has features without Anthropic equivalents: `logit_bias`, `user` field, `function_call` (deprecated but still used), and `response_format` with `json_schema`.

**Specific traps:**
- **Dropping `metadata` from Anthropic requests** means the upstream API loses user identification, affecting billing and rate limit tracking.
- **`tool_choice: "any"`** does not exist in OpenAI. The closest is `tool_choice: "required"` or omitting it. This changes model behavior significantly.
- **Image content blocks** in Anthropic format embed images as base64. In OpenAI, they must be structured as `image_url` with either base64 data URL or a URL. The proxy must detect and convert.
- **`max_tokens` vs `max_completion_tokens`** -- newer Anthropic API uses `max_tokens`, newer OpenAI uses `max_completion_tokens` (not `max_tokens` in v2). Using the wrong field name causes the parameter to be silently ignored.
- **Anthropic `thinking` blocks** have no OpenAI equivalent. If an upstream supports thinking but the proxy doesn't handle it in the response stream, the thinking content leaks into the visible text output.

**Prevention:**
- Maintain an explicit field mapping table for every field in both formats. Flag fields with no equivalent as "lossy" and log a warning when they are dropped.
- For `tool_choice`, implement a best-effort mapping: `"any"` -> `"required"`, `"tool"` -> specific function name. Log the approximation.
- For images, detect base64 content in Anthropic format and wrap as `data:image/...;base64,...` URL for OpenAI.
- For `thinking` blocks in responses, filter them out when translating to OpenAI format (they don't exist in OpenAI's spec and will cause client parse errors).

**Detection:**
- Write a conformance test: create an Anthropic request with every field populated, translate to OpenAI format, and verify critical fields survive. Do the same in reverse.

**Phase mapping:** Phase 3 (Format Translation).

---

### Pitfall 6: Non-Deterministic Sentiment Scores Across Restarts

**What goes wrong:** When the proxy restarts (e.g., after a crash, config change, or system reboot), the sentiment score state file may be stale or missing. The proxy starts with zero accumulated score. The user continues their conversation, but the proxy has no memory of the frustration signals accumulated before the restart -- the model is still degraded but the proxy acts like everything is fine.

**Why it happens:** State persistence is designed to survive crashes, but edge cases prevent it from working:
- The file was written 30 seconds before the crash, so the last few sentiment updates are lost.
- The file was being written during the crash, producing a truncated file that is rejected on restart.
- The user updated the config, which triggers a clean restart but also resets the state file intentionally.
- Multiple model slots write to the same file, and one slot's write is lost.

**Consequences:** The proxy forgets the user's frustration. The user chats for another 20 minutes with a degraded model before the score accumulates again. This is the exact problem the proxy is supposed to solve.

**Prevention:**
- **Frequent debounced checkpointing.** Persist in-memory state to disk at most every 2 seconds, but no more than 5 seconds since last write. On a crash, at most 5 seconds of state is lost.
- **Write on every significant event.** A switch event, a score threshold crossing, or a cooldown change should trigger an immediate (non-debounced) write.
- **Graceful shutdown hook.** Register `process.on('SIGINT')` and `process.on('SIGTERM')` to flush state synchronously before exit. On a systemd stop or `Ctrl+C`, the latest state is preserved.
- **Recover from truncated files.** On startup, if the file is truncated, try to parse it anyway (`JSON.parse` partial), or use the most recent valid file (`state.json.bak`). Never silently reset to zero -- log a warning and preserve any recoverable data.
- **Keep a rotating backup.** Maintain the last 3 state files (`state.json`, `state.json.bak1`, `state.json.bak2`). On corrupt read, try backups in order.

**Phase mapping:** Phase 2 (Core Proxy -- state persistence).

---

### Pitfall 7: Latency Tail From Sentiment Analysis Blocks Forwarding

**What goes wrong:** The proxy must analyze the user's message before forwarding it (to decide which upstream to use). This means the user's request is blocked on sentiment analysis. If the analysis model is slow (100-500ms), the user experiences perceptible lag on every message, making the proxy feel worse than the problem it solves.

**Why it happens:** The natural architecture is: receive request -> analyze sentiment -> choose upstream -> forward request -> return response. But "analyze sentiment" is a synchronous blocking step in that chain. If sentiment analysis uses an external API (e.g., calling an LLM to judge tone), latency spikes into seconds.

**Specific failure modes:**
1. **Sequential dependency.** The proxy cannot forward the request until it knows which upstream to use. But it cannot know which upstream until sentiment analysis completes. This is a hard sequential bottleneck.
2. **Sentiment analysis LLM call adds full round-trip latency.** If the proxy calls another AI model to analyze sentiment, the user waits for two sequential API calls (sentiment, then actual request). This doubles the perceived latency.
3. **Heavyweight analysis on every request.** Running a transformer model locally (even a small one) adds CPU load. Under concurrent requests, analysis time increases non-linearly as CPU contention grows.

**Prevention:**
- **Keep sentiment analysis local and lightweight.** A keyword-heuristic approach with pattern matching (compiled regex against the user's last 3 messages) runs in <1ms. This is fast enough to be invisible. Reserve LLM-based analysis for a periodic background audit, not per-request routing.
- **Use a fast pre-check.** Most requests are neutral and should go to the primary upstream. Implement a fast pre-check: if the user message does not contain ANY negative keywords, skip analysis entirely and use the current upstream in <1ms. Only run full analysis when there is a signal worth investigating.
- **If using an LLM for sentiment, pipeline it.** Start forwarding the request immediately (to the current upstream). Run sentiment analysis in parallel. If analysis says switch, abort the current request and retry on the backup. This adds latency only on the switch event, not on every request. The tradeoff is wasted upstream capacity on aborted requests.
- **Consider a hybrid approach:** fast keyword analysis for per-request routing, batched LLM analysis every N requests for recalibration of thresholds. The per-request path stays fast.
- **Benchmark the analysis path.** The total proxy overhead (receive -> analyze -> forward) must be under 50ms at p99. Instrument and alarm if this is exceeded.

**Detection:**
- Add timing instrumentation to every request phase: `recv_time`, `analysis_time`, `forward_time`, `response_time`. Log and alert if `analysis_time > 50ms`.
- Use a histogram of analysis latency across all requests. Watch for regressions.

**Phase mapping:** Phase 4 (Sentiment Analysis Core). The latency budget must be established during Phase 2 (Core Proxy) architecture planning.

---

## Minor Pitfalls

### Pitfall 8: Port Conflicts With Existing Development Tools

**What goes wrong:** Many local development tools use ports 3000-3100 (Node.js default, common hot-reload servers). If SentiRoute defaults to port 3000 and the user already has something there, it crashes on startup with EADDRINUSE. The user sees an opaque error and abandons installation.

**Prevention:** Default to an uncommon port (e.g., 3571, or the pattern used by 9router). Print a clear error on port conflict with instructions: `Port 3000 is in use by PID 1234 (node.exe). Use --port <port> to change.`

---

### Pitfall 9: Config File Discovery Makes Setup Feel Fragile

**What goes wrong:** If the proxy requires the config file to be in a specific location (e.g., `~/.config/sentiroute/config.yaml`) and the user doesn't know where that is, or if `XDG_CONFIG_HOME` is not set on their system, the proxy silently uses defaults with no upstreams configured. The user starts the proxy, everything looks fine, but all requests fail with "no upstream configured."

**Prevention:** Support multiple discovery paths in order of precedence:
1. `--config /path/to/file` CLI flag (highest priority)
2. `SENTIROUTE_CONFIG` environment variable
3. `./sentiroute.yaml` in current working directory
4. `~/.config/sentiroute/config.yaml` (Linux/Mac)
5. `%APPDATA%/SentiRoute/config.yaml` (Windows)
Print the resolved config path on startup so the user knows which file was loaded.

---

### Pitfall 10: Upstream API Key Rotation Requires Restart

**What goes wrong:** API keys expire, get revoked, or need rotation. If the only way to update keys is editing the config file and restarting, users will: (a) leave expired keys in the config and silently fail, (b) edit the config but forget to restart, wondering why it still fails, or (c) avoid key rotation because restarting is disruptive.

**Prevention:** Support a `POST /reload` endpoint that re-reads the config file without restarting the server. Keep the listening socket open. This makes key rotation a zero-downtime operation. Also support environment variable interpolation in the config (`$OPENROUTER_API_KEY`) so keys can be managed via shell environment.

---

### Pitfall 11: Request Logging Leaks API Keys

**What goes wrong:** If the proxy logs incoming request headers for debugging, and the user's coding tool sends the API key in the `x-api-key` header (as Anthropic API does), the API key ends up in plaintext in the log file. A developer who shares their screen, commits logs to a repo, or sends logs for debugging accidentally leaks their credentials.

**Prevention:** Implement a log sanitizer that replaces `x-api-key`, `authorization`, and `x-session-key` header values with `[REDACTED]` before writing log entries. Never log raw request bodies or headers.

---

## Phase-Specific Warnings

| Phase | Topic | Likely Pitfall | Mitigation |
|-------|-------|---------------|------------|
| Phase 2 | Core HTTP server | Port conflicts, startup order, graceful shutdown | Test with common dev tools running, implement SIGINT/SIGTERM handlers (Pitfall 8) |
| Phase 2 | State persistence | Read-modify-write race, file corruption, cross-slot corruption | Atomic writes, write queue, per-slot files (Pitfall 3) |
| Phase 3 | Format translation | SSE event structure mismatch, stop reason mapping loss, tool call boundary errors | State machine per stream, bidirectional mapping table, explicit conformance tests (Pitfall 1, 5) |
| Phase 4 | Sentiment analysis | False positives on technical language, latency overhead, context window truncation | Keyword-heuristic fast path, dual-threshold, logging-only mode first (Pitfall 2, 7) |
| Phase 5 | Calibration + Polish | Switch opacity, cooldown confusion, log noise | Status endpoint, anti-flapping, strict log levels, manual override (Pitfall 4) |
| Phase 5 | Persistence across restarts | Stale state file on crash, truncated JSON, zero-initialized scores | Debounced frequent writes, rotating backups, graceful shutdown hooks (Pitfall 6) |

## Sources

- Anthropic Messages API documentation: streaming event types (`content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`), content block index tracking, stop_reason values, tool_use content block format (Anthropic official docs)
- OpenAI Chat Completions API documentation: SSE streaming with `choices[0].delta`, `finish_reason`, `tool_calls` in delta format, `response_format` parameter (OpenAI official docs)
- 9router (github.com/decolua/9router): reference implementation for local AI API proxy pattern, inspiration for SentiRoute architecture
- Node.js `fs` module documentation: atomic file operations, `rename()` behavior across platforms, file locking limitations
- Distributed systems patterns: write-ahead log pattern, atomic rename for crash-safe persistence, read-modify-write race conditions. Sources: Martin Kleppmann "Designing Data-Intensive Applications", Chapter on "Consistency and Consensus"
- Sentiment analysis on short text: known failure modes for lexicon-based and ML-based approaches on domain-specific language, impact of context window truncation. Liu, B. "Sentiment Analysis and Opinion Mining" (Morgan & Claypool, 2012); Mohammad, S. "Sentiment Analysis: Detecting Valence, Emotions, and Other Affectual States from Text" (2021)
