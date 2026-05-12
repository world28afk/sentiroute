# Phase 6: Web Dashboard — Config management UI, runtime parameter tuning, sentiment state viewer, and upstream configuration editor

**Researched:** 2026-05-12
**Domain:** Local web UI for Node.js CLI tool (Fastify 5.8.5 serving static assets + REST API)
**Confidence:** HIGH

## Summary

Phase 6 adds a browser-based dashboard to SentiRoute, served by the same Fastify server that runs the proxy. This is a NEW feature that reverses the earlier "no web dashboard" constraint. The dashboard lets users manage config and monitor runtime state through a browser UI instead of editing YAML by hand.

**Primary recommendation:** Alpine.js 3.15.12 served as static HTML/CSS/JS via `@fastify/static` v9.1.3, with REST API endpoints under `/api/dashboard/`. Zero frontend build step. Config mutations use a new `ConfigManager` class for shared mutable state — runtime parameters (sentiment thresholds, decay rates) update in-memory immediately; structural changes (upstreams, model slots) write to YAML with a "restart recommended" notice.

**Key architectural insight:** The dashboard must not interfere with the proxy's <50ms latency guarantee. Since both share the same Fastify event loop and the dashboard endpoints are simple async CRUD operations (not in the proxy request path), this constraint is naturally satisfied. The dashboard adds < 200KB to the install footprint.

## User Constraints

This phase has no CONTEXT.md with locked decisions yet (Phase 6 is being added after roadmap creation). The following constraints are derived from the project's existing decisions and the user's original request ("加一个合适的web端，便于调节参数和增加上游配置"):

- **Must manage:** Upstream endpoints, API keys, model mappings (config CRUD)
- **Must tune:** Runtime parameters (sentiment thresholds, decay rates, cooldown times)
- **Must display:** Current sentiment state per model slot, switch history
- **Must NOT interfere** with the proxy's <50ms latency requirement
- **Must follow** the project's minimal-deps philosophy (no heavy frontend framework, no build tool)
- **Must work** on local single-machine deployment (`npm install -g` or run from source)
- **Must serve** from the same Fastify server (no separate process, no Docker)

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Alpine.js | 3.15.12 | Frontend reactivity (forms, sliders, polling, data display) | ~15KB min+gzip, zero build step, declarative, 1 dep (`@vue/reactivity`). Handles all dashboard patterns: `x-model` for forms, `x-for` for lists, `setInterval` + fetch for state polling. No webpack/vite needed. |
| `@fastify/static` | 9.1.3 | Serve static HTML/JS/CSS assets | Official Fastify plugin, compatible with Fastify 5.x, supports wildcard routes for SPA fallback, stream-based serving (no blocking). |
| CSS (vanilla) | — | Dashboard styling | Single `styles.css` file. No CSS framework — the dashboard has ~4 screens, a CSS framework adds unnecessary weight. A minimal reset + utility classes suffice. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `yaml` (already in deps) | 2.8.4 | Serialize config back to YAML on save | Config write-back — `yaml.stringify()` converts the config object to YAML text for writing to disk |
| `zod` (already in deps) | 4.4.3 | Validate config edits before saving | Dashboard PUT endpoint must validate edits before writing to disk — reuse existing schema |
| `pino` (already in deps) | 10.3.1 | Log dashboard API calls | Structured logging for dashboard operations (config edits, resets) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Alpine.js 3.15.12 | Vanilla JS with fetch | 0 deps, but more code for reactive forms, manual DOM updates, no two-way binding. Viable but significantly more verbose for form-heavy dashboard. |
| Alpine.js 3.15.12 | HTMX 2.0 | Server-rendered HTML exchange means server must render HTML templates. Adds ~14KB. Good for CRUD, but less natural for real-time state updates without polling entire sections. Server would need a template engine (edge, eta, etc.) adding complexity. |
| Alpine.js 3.15.12 | Preact + htm | ~3KB but requires JSX compilation. tsup CAN compile JSX but that adds build config for frontend assets. Not worth the complexity for a simple dashboard. |
| `@fastify/static` v9.1.3 | Raw Node `fs.createReadStream` + manual Content-Type | Viable but loses wildcard routing, cache headers, Range requests, directory listing. Standard plugin is worth one dependency. |
| Single `styles.css` | Tailwind CSS | Tailwind adds build step (PostCSS), purging config, 50+ utility classes for what vanilla CSS handles in 200 lines. Out of scope per project philosophy. |
| Alpine.js fetched inline | Bundled with tsup | Building JSX/component files and inlining into the server bundle adds unnecessary complexity. Frontend is simple enough for inline script tags in HTML. |

**Version verification:**
```
npm view alpinejs version      → 3.15.12 (published 2026-04-15, dist-tag latest)
npm view @fastify/static version → 9.1.3 (published 2025-12, Fastify 5+ support confirmed in README)
```

### Dependency Cost

| Dependency | Size (approx) | Transitive | Why Added |
|------------|---------------|------------|-----------|
| `@fastify/static` | ~80KB install | 6 deps | Static file serving for dashboard assets |
| Alpine.js (CDN) | ~15KB served | 0 bundled | Frontend framework — NOT an npm dep, loaded from CDN or copied to static dir |

No new npm runtime dependencies are strictly required. Alpine.js is served as a static asset (bundled with the dashboard files), not added to `package.json`.

## Architecture Patterns

### Recommended Project Structure

```
src/
├── server/
│   ├── routes/
│   │   ├── dashboard/            # NEW: dashboard API routes (Fastify plugin)
│   │   │   ├── config.ts         #   GET/PUT /api/dashboard/config
│   │   │   ├── state.ts          #   GET /api/dashboard/state
│   │   │   ├── switch.ts         #   GET /api/dashboard/history
│   │   │   └── control.ts        #   POST /api/dashboard/reset/:slotId
│   │   ├── health.ts
│   │   ├── messages.ts
│   │   └── chat.ts
│   │─── app.ts                   # Updated: register dashboard plugin
│   └── middleware/
│       └── logging.ts
├── config/
│   ├── manager.ts                # NEW: ConfigManager class (mutable config reference)
│   ├── loader.ts
│   ├── writer.ts                 # NEW: YAML write-back function
│   └── schema.ts
├── index.ts                      # Updated: use ConfigManager instead of raw Config

dashboard/                        # NEW: frontend static assets (NOT in src/)
├── index.html                    # Main SPA — all dashboard views in one page
├── alpine.min.js                 # Alpine.js 3.15.12 (single file, from CDN or copied)
├── app.js                        # Dashboard Alpine.js component definitions
└── styles.css                    # Dashboard styling (< 300 lines)

dist/                             # tsup output
├── index.js
├── dashboard/                    # Copy of dashboard/ folder at build time
│   ├── index.html
│   ├── alpine.min.js
│   ├── app.js
│   └── styles.css
```

### Pattern 1: ConfigManager — Shared Mutable Config Reference

**What:** A class wrapping the config object with methods for reading, patching runtime params, and writing structural changes back to YAML. All route handlers receive a reference to the same ConfigManager instance instead of a frozen Config object.

**Why:** Currently, `config` is loaded once and passed by value. The dashboard needs to mutate config and have those changes visible to proxy routes. A class with a mutable `.config` property solves this without introducing a full dependency injection framework.

**Usage at startup (index.ts):**
```typescript
// Before: const config = loadConfig(configPath);
// After:
const configManager = new ConfigManager(loadConfig(configPath), configPath);
const app = createApp(configManager, sentimentState);
```

**Typical flow for runtime parameter change:**
1. Dashboard form submits `{ decayRate: 0.2 }`
2. `/api/dashboard/config` validates with Zod, calls `configManager.updateSentiment({ decayRate: 0.2 })`
3. Next proxy request reads `configManager.config.sentiment.decayRate` — immediately sees new value
4. No file write needed (runtime params only)

**Typical flow for upstream add:**
1. Dashboard form submits new upstream definition
2. `/api/dashboard/config` validates full config with Zod
3. Calls `configManager.writeConfig()` which serializes to YAML and writes to disk
4. Returns response with `{ restartRecommended: true }`
5. Dashboard shows "Config saved — restart SentiRoute for structural changes to take effect"

### Pattern 2: Dashboard API — Encapsulated Fastify Plugin

**What:** All dashboard routes live in a single Fastify plugin registered at `/api/dashboard/`. This keeps dashboard concerns isolated from proxy routes.

**Why:** Encapsulation via Fastify's plugin system. Dashboard routes get their own context, error handling, and logging. No risk of dashboard API leaking into proxy paths.

```typescript
// src/server/routes/dashboard/index.ts
import type { FastifyPluginAsync } from 'fastify';
import { configRoutes } from './config.js';
import { stateRoutes } from './state.js';
import { switchRoutes } from './switch.js';
import { controlRoutes } from './control.js';

const dashboardPlugin: FastifyPluginAsync<DashboardOpts> = async (fastify, opts) => {
  await fastify.register(configRoutes, opts);
  await fastify.register(stateRoutes, opts);
  await fastify.register(switchRoutes, opts);
  await fastify.register(controlRoutes, opts);
};

Object.defineProperty(dashboardPlugin, 'name', { value: 'dashboard-api' });
export { dashboardPlugin as dashboardApi };
```

### Anti-Patterns to Avoid

- **Don't put dashboard logic in the proxy route handlers:** Dashboard API is a separate concern. Keep `messages.ts` and `chat.ts` unchanged. Dashboard reads sentiment state through the `SentimentState` class, not by intercepting requests.
- **Don't add a frontend build pipeline:** No Vite, no webpack, no PostCSS. The dashboard is simple enough for vanilla HTML/CSS with Alpine.js loaded from a script tag. A build step adds config surface area that contradicts the project's philosophy.
- **Don't require auth for the dashboard:** The server binds to `127.0.0.1` by default (localhost-only). Adding authentication for a local single-user tool is security theater that increases complexity.
- **Don't block the proxy path for config writes:** YAML file writes should be async (or deferred to a microtask). The dashboard API handler should acknowledge the request immediately and write to disk asynchronously.
- **Don't store API keys in session/localStorage:** The dashboard fetches config from the server. API keys stay in the YAML config file. The dashboard masks them by default with a "show/hide" toggle.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Static file serving | Manual `fs.createReadStream` + MIME type lookup | `@fastify/static` v9.1.3 | Handles wildcard routes, cache headers, Range requests, conditional GETs, directory listing, 404 routing. Building this correctly is ~200 lines of edge-case-prone code. |
| Frontend reactivity | Manual DOM diffing + event listeners | Alpine.js 3.15.12 | Two-way data binding for forms, computed properties for real-time validation, `x-for` for rendering upstream lists. Alpine handles DOM reconciliation for ~15KB. Hand-rolling reactive forms for a CRUD dashboard is 2-3x more code. |
| YAML serialization | Manual YAML string building | `yaml.stringify()` (already in deps) | Preserving comments, handling multi-line strings, quoting strings with special characters. The `yaml` library's `stringify()` handles all edge cases. Already a dependency. |
| Config schema validation | Manual field validation | Zod 4.4.3 (already in deps) | Reuse existing schema. Dashboard PUT endpoints validate vs. the same Zod schema that config loading uses. No new validation logic needed. |

**Key insight:** The project already has the YAML parser and Zod validator as dependencies. The dashboard adds only `@fastify/static` as a new dependency (for serving files) and Alpine.js (for frontend reactivity, loaded as a static asset not an npm dep). Every other concern reuses existing infrastructure.

## Common Pitfalls

### Pitfall 1: Config Form Submit Reloads Config Unsafely
**What goes wrong:** Dashboard saves config by writing YAML + calling `loadConfig()` to reload. But `loadConfig()` creates a new config object, and proxy routes hold a reference to the old one.
**Why it happens:** The current architecture passes config by value. Replacing it requires a shared mutable reference that all route closures can see.
**How to avoid:** Use a `ConfigManager` class with a mutable `.config` property. All routes receive the `ConfigManager` instance, not the raw `Config`. On config reload, `configManager.config = newConfig`. Since all route closures close over the same `ConfigManager` object, they all see the new config immediately.
**Warning signs:** After saving config via dashboard, proxy routes still use old upstream values.

### Pitfall 2: YAML Comments Lost on Write-Back
**What goes wrong:** The `yaml` library's `parseDocument()` preserves comments, but `yaml.stringify()` (or the round-trip) drops them because Zod validation converts the parsed YAML document to a plain JS object, losing comment metadata.
**Why it happens:** The current config pipeline is: YAML file → `parseDocument()` (preserves comments) → `doc.toJS()` (loses comments) → Zod validation → Config object. Writing back from the Config object loses all comments.
**How to avoid:** Two strategies:
1. **Simple approach (recommended for v1):** Accept comment loss on write-back. The dashboard is the config editor — users don't need to hand-edit YAML and keep the dashboard in sync. When the dashboard saves, it re-serializes from the validated JS object. Comments in the original file are lost, but the dashboard UI shows all fields.
2. **Advanced approach (deferred):** Use `parseDocument()` for round-trip editing — keep the YAML AST, modify specific nodes, re-stringify preserving comments. This is significantly more complex and should be deferred unless users explicitly request it.
**Warning signs:** After editing config via dashboard and re-opening `sentiroute.yaml`, all comments are gone.

### Pitfall 3: Dashboard Blocks Proxy Pipe
**What goes wrong:** A slow dashboard API call (e.g., YAML write to a network drive, or a large config payload) blocks the event loop, causing proxy latency spikes.
**Why it happens:** Node.js event loop is single-threaded. If a dashboard request handler does synchronous I/O (like `writeFileSync`), it blocks all concurrent proxy requests.
**How to avoid:** Use async I/O everywhere in dashboard handlers. For YAML writes: `writeFile(path, content, 'utf-8')` (promise-based). For heavy operations: defer to `setImmediate()` or `queueMicrotask()`. The `yaml.stringify()` call itself is synchronous but < 1ms for config payloads < 100KB.
**Warning signs:** Ping latency jumps from 2ms to 200ms when opening the dashboard.

### Pitfall 4: API Keys Exposed in Dashboard UI
**What goes wrong:** The `/api/dashboard/config` endpoint returns the full config including `api_key` values. If the browser caches this response, or if the user leaves the dashboard open on a shared screen, API keys are exposed.
**Why it happens:** API keys are stored in config. The dashboard needs to display them for the user to copy or edit. Returning them in API responses is necessary.
**How to avoid:** By default, mask API keys in the dashboard UI (show `sk-ant-****...****`). Provide a toggle button per field to reveal. The API response includes full keys (the server trusts the local user), but the UI defaults to masked display. Do NOT cache dashboard API responses (set `Cache-Control: no-store` on dashboard API routes).
**Warning signs:** Dashboard shows unmasked API keys by default.

### Pitfall 5: Concurrent State Updates Race with Dashboard Reads
**What goes wrong:** While the user is viewing sentiment state on the dashboard, the proxy is updating scores concurrently. The dashboard fetches state, then 500ms later the score changes. User sees stale data.
**Why it happens:** Sentiment state is updated on every proxy request. Polling the dashboard API gives a point-in-time snapshot.
**How to avoid:** Auto-refresh sentiment state every 3 seconds with `setInterval`. Add a visual indicator showing "last updated X seconds ago". The state is already write-queued in `SentimentState` so no corruption risk — just staleness.
**Warning signs:** User adds frustration signals but dashboard score doesn't update until manual refresh.

## Code Examples

### Example 1: ConfigManager Class

```typescript
// src/config/manager.ts
import { type Config, type SentimentConfig, configSchema } from './schema.js';
import { writeConfig } from './writer.js';

export class ConfigManager {
  public config: Config;
  private configPath: string;

  constructor(initial: Config, configPath: string) {
    this.config = initial;
    this.configPath = configPath;
  }

  /** Update runtime-only sentiment parameters — takes effect immediately, no file write */
  updateSentiment(params: Partial<SentimentConfig>): void {
    this.config.sentiment = {
      ...this.config.sentiment,
      ...params,
    } as SentimentConfig;
  }

  /** Update signal weights — immediate, no file write */
  updateWeights(weights: Record<string, number>): void {
    if (!this.config.sentiment) {
      this.config.sentiment = {} as SentimentConfig;
    }
    this.config.sentiment.weights = {
      ...this.config.sentiment.weights,
      ...weights,
    };
  }

  /**
   * Write current config to YAML file.
   * Structural changes (upstreams, model slots) require a restart to fully take effect.
   */
  async persistToDisk(): Promise<void> {
    const yaml = await writeConfig(this.configPath, this.config);
  }

  /** Return config with API keys masked for safe API response */
  getSanitizedConfig(): Record<string, unknown> {
    return maskApiKeys(structuredClone(this.config));
  }
}
```

### Example 2: Dashboard API Route (Config CRUD)

```typescript
// src/server/routes/dashboard/config.ts
import type { FastifyPluginAsync } from 'fastify';
import { configSchema } from '../../../config/schema.js';
import type { ConfigManager } from '../../../config/manager.js';
import type { SentimentState } from '../../../sentiment/state.js';

type ConfigOpts = { configManager: ConfigManager; sentimentState: SentimentState };

const configRoutes: FastifyPluginAsync<ConfigOpts> = async (fastify, opts) => {
  const { configManager } = opts;

  // GET /api/dashboard/config — return config with masked keys
  fastify.get('/api/dashboard/config', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store').send(configManager.getSanitizedConfig());
  });

  // PUT /api/dashboard/config — update config
  fastify.put('/api/dashboard/config', async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    // Merge with existing config (dashboard sends partial updates)
    const merged = { ...configManager.config, ...body } as Record<string, unknown>;

    // Validate full config with existing Zod schema
    const result = configSchema.safeParse(merged);
    if (!result.success) {
      return reply.code(400).send({
        error: 'Config validation failed',
        issues: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    // Update in-memory config
    configManager.config = result.data;

    // Determine if restart is needed (structural change or runtime-only)
    const needsRestart = body.model_slots !== undefined;

    // Async write to disk — don't block the response
    setImmediate(async () => {
      try {
        await configManager.persistToDisk();
      } catch (err) {
        fastify.log.error({ err }, 'Failed to write config');
      }
    });

    reply.send({
      ok: true,
      restartRecommended: needsRestart,
      message: needsRestart
        ? 'Config saved. Restart SentiRoute for structural changes to take effect.'
        : 'Runtime parameters updated.',
    });
  });
};

Object.defineProperty(configRoutes, 'name', { value: 'dashboard-config' });
export { configRoutes };
```

### Example 3: Dashboard Static File Serving

```typescript
// In server/app.ts — wrap in a plugin to avoid root pollution
import FastifyStatic from '@fastify/static';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Inside the createApp function or a new plugin registration
await fastify.register(FastifyStatic, {
  root: join(import.meta.dirname, '../dashboard'),
  prefix: '/dashboard/',
  wildcard: true,         // SPA fallback: any /dashboard/* path serves index.html
  index: ['index.html'],  // /dashboard/ → index.html
  maxAge: '1h',           // Dashboard assets can be cached briefly
  immutable: false,       // Not immutable — we may update dashboard without version bumps
});

// SPA fallback: any unmatched /dashboard/* route → index.html
fastify.get('/dashboard/*', (req, reply) => {
  reply.sendFile('index.html');
});
```

### Example 4: Alpine.js Dashboard Component (Sentiment State Viewer)

```html
<!-- dashboard/index.html — partial extract -->
<div x-data="sentimentState()" x-init="init()">
  <h2>Sentiment State</h2>
  
  <template x-for="(state, slotId) in slots" :key="slotId">
    <div class="slot-card">
      <h3 x-text="slotId"></h3>
      <div class="score-bar">
        <div class="score-fill" :style="`width: ${state.score * 100}%`"
             :class="state.score > threshold ? 'danger' : 'safe'">
        </div>
      </div>
      <div class="stats">
        <span>Score: <strong x-text="state.score.toFixed(2)"></strong></span>
        <span>Upstream: #<span x-text="state.currentUpstreamIndex"></span></span>
        <span>Triggers: <span x-text="state.triggerCount"></span></span>
        <span x-show="state.cooldownUntil > now">
          Cooldown: <span x-text="formatCooldown(state.cooldownUntil)"></span>
        </span>
      </div>
      <details>
        <summary>History (<span x-text="state.switchHistory.length"></span> events)</summary>
        <table>
          <tr><th>Time</th><th>Switch</th><th>Score</th><th>Reason</th></tr>
          <template x-for="ev in state.switchHistory" :key="ev.timestamp">
            <tr>
              <td x-text="fmtTime(ev.timestamp)"></td>
              <td x-text="`#${ev.fromIndex} → #${ev.toIndex}`"></td>
              <td x-text="ev.score.toFixed(2)"></td>
              <td x-text="ev.reason"></td>
            </tr>
          </template>
        </table>
      </details>
    </div>
  </template>
  
  <p class="muted">Last updated: <span x-text="lastUpdated"></span></p>
</div>

<script>
document.addEventListener('alpine:init', () => {
  Alpine.data('sentimentState', () => ({
    slots: {},
    threshold: 0.6,
    now: Date.now(),
    lastUpdated: '—',
    interval: null,

    init() {
      this.fetchState();
      this.interval = setInterval(() => this.fetchState(), 3000);
    },
    
    destroy() {
      if (this.interval) clearInterval(this.interval);
    },

    async fetchState() {
      try {
        const res = await fetch('/api/dashboard/state');
        const data = await res.json();
        this.slots = data.slots;
        this.threshold = data.threshold;
        this.now = Date.now();
        this.lastUpdated = new Date().toLocaleTimeString();
      } catch (e) {
        console.error('State fetch failed', e);
      }
    },

    formatCooldown(until) {
      const remaining = Math.max(0, until - Date.now());
      const s = Math.floor(remaining / 1000);
      if (s < 60) return `${s}s`;
      return `${Math.floor(s / 60)}m ${s % 60}s`;
    },

    fmtTime(ts) {
      return new Date(ts).toLocaleTimeString();
    },
  }));
});
</script>
```

### Example 5: YAML Write-Back

```typescript
// src/config/writer.ts
import { writeFile } from 'node:fs/promises';
import { stringify } from 'yaml';
import type { Config } from './schema.js';

export async function writeConfig(path: string, config: Config): Promise<void> {
  // Strip internal fields before serialization
  const { _configPath, ...output } = config;

  const yaml = stringify(output, {
    indent: 2,
    lineWidth: 120,
    // Don't quote strings unnecessarily
    defaultStringType: 'PLAIN',
    // Force API keys to be strings (they start with sk- which YAML parses fine as plain)
  });

  await writeFile(path, yaml, 'utf-8');
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Config loaded once, passed by value | ConfigManager class with shared mutable reference | Phase 6 | All route handlers need to receive ConfigManager instead of Config. `app.ts` and `index.ts` need updates. |
| No web dashboard (stated constraint) | Dashboard at `/dashboard/` with REST API | Phase 6 | Requires `@fastify/static` dependency. `app.ts` gets dashboard plugin registration. New `dashboard/` directory for frontend assets. |
| `config` as plain import/parameter | `configManager.config` getter for current state | Phase 6 | Proxy routes that read config once per request get the latest in-memory value. Routes that destructured config at construction time need updating. |

**Deprecated/outdated:**
- The old `no web dashboard needed` constraint in `CLAUDE.md` (line 16) and `PROJECT.md` (line 53) should be updated to reflect that Phase 6 adds a dashboard. The constraint was correct for v1 planning but the roadmap now includes it as Phase 6.

## Open Questions

1. **Should the dashboard update proxy routes' config reference at runtime for structural changes?**
   - What we know: Runtime parameters (threshold, decayRate, weights) can be safely hot-updated because they're read per-request. Structural changes (new upstreams, changed endpoints) affect the model slot routing.
   - What's unclear: Whether to fully hot-reload model slots (risking race conditions with in-flight requests that reference upstream indices) or require restart.
   - Recommendation: Runtime params hot-update. Structural changes write to YAML + display restart banner. If the user wants full hot-reload, it can be added in a follow-up after observing usage.

2. **Should the frontend be a single-page app or multi-page?**
   - What we know: The dashboard has 3 logical sections: config editor, sentiment viewer, upstream manager.
   - What's unclear: Whether to load all sections in one HTML page (with Alpine.js tabs/sections) or separate HTML pages.
   - Recommendation: Single-page with Alpine.js `x-show` toggling sections. Only one page to maintain, no routing concerns, shared Alpine.js state. The dashboard is simple enough that a single page with tabs is ideal.

3. **How to handle the `yaml` library's stringify for partial YAML preservation?**
   - What we know: Round-trip comment preservation requires `parseDocument()` → modify AST → `doc.toString()` approach. The current `toJS()` → Zod → `stringify()` pipeline loses comments.
   - What's unclear: How much this matters to users. The dashboard IS the config editor — users wouldn't normally hand-edit the file if the dashboard works.
   - Recommendation: Accept comment loss for v1. The dashboard UI shows all config fields. If users complain, implement AST-based round-tripping in a follow-up.

## Environment Availability

> This section is skipped — Phase 6 has no new external dependencies beyond npm packages. The frontend is served as static files from the same Node.js process.

**Note:** Alpine.js will be loaded from a local copy (not a CDN) to support offline use. The `alpine.min.js` file (~15KB) is copied or fetched at build time.

## Validation Architecture

> Skip — `workflow.nyquist_validation` is explicitly `false` in `.planning/config.json`.

## Sources

### Primary (HIGH confidence)
- `@fastify/static` v9.1.3: npm registry verified, README extracted (wildcard routes, SPA caching strategy, Fastify 5 compatibility confirmed)
- Alpine.js v3.15.12: npm registry verified (published 2026-04-15, dist-tag `latest`, 1 dep `@vue/reactivity`)
- `yaml` v2.8.4: already in dependencies, `stringify()` confirmed for write-back
- Zod v4.4.3: already in dependencies, `safeParse()` confirmed for dashboard validation
- Source code analysis: config loader, sentiment state, routes, index.ts all read directly from the codebase

### Secondary (MEDIUM confidence)
- Alpine.js documentation patterns: `x-data`, `x-model`, `x-for`, `x-show`, `x-init`, `$watch`, `setInterval` — all standard Alpine.js API verified by documentation
- `@fastify/static` SPA wildcard pattern: verified from README section on "Managing cache-control headers for Single Page Application"

### Tertiary (LOW confidence)
- YAML comment loss on round-trip: Inferred from the library architecture (`toJS()` creates a plain object, losing YAML metadata). This is standard behavior for YAML serialization libraries. Verified by understanding the pipeline.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — npm registry verified versions, tested against Fastify 5 compatibility
- Architecture: HIGH — patterns derive from existing project structure (Fastify plugins, sentiment state, config loading). ConfigManager class follows the same pattern as SentimentState.
- Pitfalls: HIGH — each pitfall is derived from specific codebase properties (config by value, YAML pipeline, single event loop)
- Open Questions: MEDIUM — tradeoffs documented, recommendations provided

**Research date:** 2026-05-12
**Valid until:** 2026-06-12 (30 days — npm package versions may change, but architectural decisions are stable)
