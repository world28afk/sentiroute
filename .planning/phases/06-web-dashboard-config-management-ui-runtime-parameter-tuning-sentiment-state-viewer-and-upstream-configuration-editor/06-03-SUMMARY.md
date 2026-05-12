---
phase: 06-web-dashboard-config-management-ui-runtime-parameter-tuning-sentiment-state-viewer-and-upstream-configuration-editor
plan: "03"
subsystem: ui
tags: [alpine-js, fastify-static, dashboard, frontend, config-editor, sentiment-viewer]

requires:
  - phase: "06-01"
    provides: ConfigManager (mutable config reference), YAML write-back, API key masking
  - phase: "06-02"
    provides: Dashboard API routes (config, state, switch, control), DashboardOpts type

provides:
  - Dashboard frontend with three tabbed sections (Config, Sentiment, History)
  - Static file serving via @fastify/static at /dashboard/ prefix
  - ConfigManager integration into app startup and proxy route config references
  - Runtime parameter hot-update preserving proxy route object references
  - API key masking with per-field show/hide toggle

affects: [testing, user-documentation]

tech-stack:
  added:
    - @fastify/static v9.1.3 (static file serving)
    - Alpine.js v3.15.12 (frontend reactivity, local bundle 46KB)
  patterns:
    - ConfigManager as shared mutable config reference for all route handlers
    - Runtime params update in-place via ConfigManager.updateSentiment()
    - Structural config changes validated with Zod but require restart
    - Dashboard static assets copied to dist/ via tsup onSuccess hook

key-files:
  created:
    - dashboard/index.html (single-page dashboard, 260+ lines)
    - dashboard/styles.css (dark theme stylesheet, 350+ lines)
    - dashboard/app.js (Alpine.js component definitions, 275+ lines)
    - dashboard/alpine.min.js (Alpine.js v3.15.12 CDN bundle, 46KB)
  modified:
    - src/server/app.ts (async createApp, ConfigManager param, FastifyStatic + dashboardApi registration)
    - src/index.ts (ConfigManager construction, async main, dashboard URL log)
    - tsup.config.ts (onSuccess hook for dashboard asset copy)
    - src/server/routes/dashboard/config.ts (Zod validation before runtime-only update path)
    - package.json (@fastify/static added to dependencies)

key-decisions:
  - "Runtime sentiment parameter changes use ConfigManager.updateSentiment() which mutates config.sentiment in-place, preserving the object reference so proxy routes see new values immediately"
  - "Structural config changes (model_slots) still replace configManager.config fully — restart banner displayed because proxy routes hold stale reference"
  - "Zod validation runs BEFORE branching into structural vs runtime path — ensures even runtime-only changes are validated against the full schema"
  - "Dashboard path resolution uses import.meta.url relative path with production check (/dist/ pattern) to work in both dev (tsx) and production (dist) modes"

patterns-established:
  - "Dashboard static files in dashboard/ root directory, copied to dist/dashboard/ at build time via tsup onSuccess"
  - "Path resolution for static assets: dev uses src/server/../../dashboard, production uses dist/dashboard based on import.meta.url"
  - "Alpine.js loaded as local CDN bundle (alpine.min.js), not as npm dependency — enables offline use"
  - "FastifyStatic registered with wildcard: false (explicit routes only) and index: ['index.html'] for directory root"

requirements-completed: [DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-08]

duration: 5min
completed: 2026-05-12
---

# Phase 6 Plan 3: Dashboard Frontend and App Wiring

**Single-page browser dashboard with Alpine.js — config editor, sentiment state viewer with 3-second polling, switch history browser, and upstream configuration editor — all served from the same Fastify proxy server**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-12T10:45:10Z
- **Completed:** 2026-05-12T10:49:45Z
- **Tasks:** 3
- **Files created/modified:** 11

## Accomplishments

- Created dashboard/index.html with 3 tabbed sections (Config, Sentiment, History) using Alpine.js x-show directives
- Created dashboard/styles.css with dark theme, score bars, form inputs, tables, and responsive layout
- Created dashboard/app.js with 4 Alpine.data components (dashboard, configEditor, sentimentViewer, historyViewer) and window.resetSlot global function
- Bundled Alpine.js v3.15.12 as local static asset (46KB, no CDN dependency)
- Installed and wired @fastify/static to serve dashboard assets at /dashboard/ prefix
- Made createApp() async to support await plugin registration
- Changed createApp() signature from Config to ConfigManager — proxy routes receive configManager.config (live reference)
- Fixed config.ts PUT handler: always validates with Zod first, uses updateSentiment() for runtime-only changes preserving proxy route references
- Created 06-RESEARCH.md source files (manager.ts, mask.ts, writer.ts, dashboard routes + tests) from main repo

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire server for dashboard** - `18cca43` (feat) + `6f4fa2e` (fix)
   - @fastify/static installed, tsup configured, app.ts + index.ts updated, config.ts PUT handler fixed
2. **Task 2: Create dashboard HTML and CSS** - `0f3d378` (feat)
   - dashboard/index.html (260+ lines), dashboard/styles.css (350+ lines)
3. **Task 3: Create Alpine.js app logic and library** - `11da373` (feat)
   - dashboard/app.js (275+ lines), dashboard/alpine.min.js (46KB)

## Files Created/Modified

- `dashboard/index.html` - Single-page SPA with 3 Alpine.js tabs, upstream config table with API key masking, restart banner, score bars, switch history tables
- `dashboard/styles.css` - Dark theme (GitHub-style), CSS custom properties, responsive breakpoint at 768px
- `dashboard/app.js` - 4 Alpine.data components (dashboard, configEditor, sentimentViewer, historyViewer) + window.resetSlot
- `dashboard/alpine.min.js` - Alpine.js v3.15.12 CDN bundle (local, no CDN dependency)
- `src/server/app.ts` - createApp now async, accepts ConfigManager, registers FastifyStatic at /dashboard/ prefix + dashboardApi plugin
- `src/index.ts` - ConfigManager construction, async main(), dashboard URL in startup log
- `tsup.config.ts` - onSuccess hook copies dashboard/ to dist/dashboard/
- `src/server/routes/dashboard/config.ts` - PUT handler restructured: always validates merged config with Zod first, uses updateSentiment() for runtime-only changes (preserves proxy route references)
- `package.json` - @fastify/static added as dependency

## Decisions Made

- **Sentiment hot-update preserves proxy route references:** The PUT handler validates merged config with Zod but calls ConfigManager.updateSentiment() for runtime-only changes. This mutates config.sentiment in-place (same object reference), so proxy routes reading opts.config.sentiment at request time see the updated values.
- **Structural changes replace config reference:** When model_slots is in the body, configManager.config is replaced entirely. Proxy routes hold a stale reference to the old config, so the restart banner is shown.
- **Zod validation always runs first:** Even for runtime-only changes, the full merged config is validated against configSchema. This catches invalid inputs (e.g., `{ server: { port: 'not-a-number' } }`) early and returns 400.
- **Local Alpine.js bundle:** Alpine.js is loaded from dashboard/alpine.min.js (downloaded from CDN at build time, stored as a static file), not from an npm dependency. Enables offline use with zero additional npm dependencies.

## Deviations from Plan

### Rule 1 - Bug Fix: Config PUT handler always replaced configManager.config, breaking proxy route references

- **Found during:** Task 1 (config.ts update)
- **Issue:** The original PUT handler from Plan 06-02 always did `configManager.config = result.data`, replacing the entire config object reference. Proxy routes hold `routeOpts.config` pointing to the old reference, so they never see updates (even runtime params).
- **Fix:** Restructured PUT handler to:
  1. Always validate merged config with Zod (catches invalid inputs)
  2. For structural changes (model_slots): replace configManager.config (restart needed)
  3. For runtime-only changes: use configManager.updateSentiment() which mutates config.sentiment in-place, preserving the object reference shared with proxy routes
- **Files modified:** `src/server/routes/dashboard/config.ts`
- **Verification:** All 165 tests pass (including the "updates in-memory config" test and "returns 400 on invalid config" test)
- **Committed in:** `18cca43` (Task 1 commit) + `6f4fa2e` (fix commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Runtime sentiment parameter hot-updates now work correctly. Proxy routes see new threshold/decay values immediately without restart.

## Issues Encountered

- **Worktree divergence:** The execution worktree was created from the initial commit before Plans 06-01 and 06-02. Source files (manager.ts, mask.ts, writer.ts, dashboard routes) needed to be copied from the main repo master branch before Plan 06-03 tasks could execute.

## Stub Tracking

No stubs found. Dashboard is fully wired end-to-end:
- Config tab fetches from GET /api/dashboard/config and saves via PUT /api/dashboard/config
- Sentiment tab polls GET /api/dashboard/state every 3 seconds
- History tab fetches from GET /api/dashboard/history
- Slot reset calls POST /api/dashboard/reset/:slotId
- API key masking uses the server-side `maskApiKeys()` function delivered via GET config response
- Placeholder attributes on input fields are HTML hints (not functional stubs)
- Default endpoint `https://api.example.com/v1` for new upstream rows is intentional default behavior

## User Setup Required

None - no external service configuration required. Dashboard loads at http://127.0.0.1:3000/dashboard/ after starting the SentiRoute server.

## Verification

- TypeScript compiles cleanly: `npx tsc --noEmit` exits 0
- Build: `npm run build` succeeds, dist/dashboard/ contains all 4 assets
- Tests: 165 tests pass across 16 test files
- All acceptance criteria for Tasks 1-3 satisfied

## Next Phase Readiness

- Dashboard frontend complete — Phase 6 is now fully implemented
- End-to-end verification: start server with `node dist/index.js`, open http://127.0.0.1:3000/dashboard/ in browser
- Proxy routes continue to function normally — dashboard is an additive feature, not a replacement

---
*Phase: 06-web-dashboard-config-management-ui-runtime-parameter-tuning-sentiment-state-viewer-and-upstream-configuration-editor*
*Completed: 2026-05-12*

## Self-Check: PASSED

- [x] All files exist (dashboard/index.html, dashboard/styles.css, dashboard/app.js, dashboard/alpine.min.js, src/server/app.ts, src/index.ts, tsup.config.ts, src/server/routes/dashboard/config.ts)
- [x] All commits found (18cca43, 6f4fa2e, 0f3d378, 11da373)
- [x] 165 tests pass across 16 test files
- [x] TypeScript compiles cleanly
- [x] Build produces dist/dashboard/ with all 4 assets
