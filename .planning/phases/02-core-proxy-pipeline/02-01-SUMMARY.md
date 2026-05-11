---
phase: 02-core-proxy-pipeline
plan: 01
subsystem: proxy
tags: [zod, config, upstream, fetch, streaming, timeout, anthropic, openai]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: config schema (configSchema, upstreamConfigSchema), types barrel, project structure
provides:
  - timeoutMs field on upstream config schema with 120000ms default
  - ResolvedSlot interface with model slot resolution (primary/backup/fallback)
  - UpstreamResult/UpstreamOptions types for executor contracts
  - executeUpstream() with fetch, streaming, error passthrough, and timeout
affects: [02-core-proxy-pipeline plan 02, route handlers]

# Tech tracking
tech-stack:
  added: [Node.js built-in fetch, AbortController combinators]
  patterns:
    - TDD with vitest (RED/GREEN per task)
    - Manual AbortSignal combining for Node 18 compatibility (no AbortSignal.any())
    - Discriminated union return type (UpstreamResult = error | streaming | complete)
    - Timeout discriminated via Error('timeout') message check (504 vs 502)

key-files:
  created:
    - src/proxy/router.ts: model slot resolution
    - src/proxy/executor.ts: upstream HTTP execution
    - src/proxy/__tests__/router.test.ts: router unit tests
    - src/proxy/__tests__/executor.test.ts: executor unit tests
  modified:
    - src/config/schema.ts: added timeoutMs field
    - src/types/index.ts: new type exports
    - src/config/__tests__/config.test.ts: timeoutMs schema tests

key-decisions:
  - "timeoutMs defaults to 120000 (2 minutes) matching Anthropic's recommended timeout"
  - "Manual combineSignals() used instead of AbortSignal.any() for Node 18 compatibility"
  - "Error('timeout') message discriminator for 504 vs 502 error responses"
  - "Router uses ?? 120000 fallback as defense-in-depth beyond schema default"

patterns-established:
  - "TDD with vitest: RED test commit followed by GREEN implementation commit per task"
  - "Proxy modules use discriminated union return types for predictable caller handling"
  - "Manual AbortController combining for cross-platform signal management"

requirements-completed: [CORE-04, CORE-05, CONF-04]

# Metrics
duration: 8min
completed: 2026-05-11
---

# Phase 02 Plan 01: Proxy Pipeline Core Summary

**Config timeoutMs field, model slot resolver, and upstream HTTP executor with streaming and error passthrough**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-11T15:41:00Z
- **Completed:** 2026-05-11T15:49:00Z
- **Tasks:** 3 (each TDD: RED + GREEN commits)
- **Files modified:** 7

## Accomplishments
- Added `timeoutMs: z.coerce.number().int().positive().default(120000)` to upstream config schema with 4 schema tests
- Created `resolveSlot()` in proxy router: maps user-visible model IDs to ResolvedSlot with primary/backup/fallback logic
- Created `executeUpstream()` in proxy executor: handles fetch with Anthropic and OpenAI auth headers, streaming response passthrough, 4xx/5xx error passthrough, timeout (504) and network error (502) handling
- Exported `ResolvedSlot`, `UpstreamResult`, `UpstreamOptions` through types barrel

## Task Commits

Each task was committed atomically with TDD pattern (RED failing test, then GREEN implementation):

1. **Task 1: Add timeoutMs to config schema + export type scaffolds**
   - `f51f7a5` (test): add failing tests for timeoutMs schema field
   - `ed023b7` (feat): add timeoutMs to config schema and export type scaffolds

2. **Task 2: Create proxy/router.ts -- model slot resolution**
   - `59719d3` (test): add failing tests for resolveSlot router
   - `fca8fe8` (feat): create proxy router with model slot resolution

3. **Task 3: Create proxy/executor.ts -- upstream HTTP execution with streaming**
   - `de801b9` (test): add failing tests for executeUpstream executor
   - `edd70ec` (feat): create upstream executor with streaming and error passthrough

**Plan metadata:** _(pending final commit)_

## Files Created/Modified
- `src/config/schema.ts` - Added `timeoutMs` field to upstreamConfigSchema with zod validation (coerce, int, positive, default 120000)
- `src/types/index.ts` - Added re-exports: `ResolvedSlot`, `UpstreamResult`, `UpstreamOptions`
- `src/config/__tests__/config.test.ts` - 4 new tests: default, explicit, coercion, negative rejection
- `src/proxy/router.ts` - New: `ResolvedSlot` interface + `resolveSlot()` function
- `src/proxy/executor.ts` - New: `UpstreamResult` type, `UpstreamOptions` interface, `executeUpstream()` function, `combineSignals()` helper
- `src/proxy/__tests__/router.test.ts` - 7 unit tests covering all resolution paths
- `src/proxy/__tests__/executor.test.ts` - 8 unit tests covering streaming, errors, timeouts, auth headers

## Decisions Made
- **timeoutMs default of 120000** matches Anthropic's recommended upstream timeout
- **Manual combineSignals()** over AbortSignal.any() for Node 18 compatibility
- **Error('timeout') message discriminator** distinguishes timeout (504) from network errors (502)
- **Router uses ?? 120000 fallback** as defense-in-depth beyond schema default

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Timeout test mock fetch did not honor AbortSignal**
- **Found during:** Task 3 (executor tests, timeout test)
- **Issue:** The mock fetch implementation created a pending Promise with setTimeout that ignored the AbortSignal. When the timeout fired and aborted the AbortController, the mock Promise did not reject, causing the test to hang past the 5000ms test timeout.
- **Fix:** Changed mock fetch to listen for `options.signal.addEventListener('abort', ...)` and reject immediately when the abort fires, properly simulating real fetch behavior with timeout.
- **Files modified:** `src/proxy/__tests__/executor.test.ts`
- **Verification:** Timeout test passes in 15ms (was timing out at 5s+)
- **Committed in:** edd70ec (Task 3 feat commit)

**2. [Rule 3 - Blocking] TypeScript errors from Config type requiring timeoutMs**
- **Found during:** Task 3 (typecheck after executor tests fixed)
- **Issue:** The inferred Config type (z.infer) required `timeoutMs: number` because `.default()` makes it non-optional in the output type. The router test's test data omitted timeoutMs on two upstream configs, causing TS2741 errors.
- **Fix:** Added `timeoutMs` fields to test data objects. Added a dedicated test using `undefined as unknown as number` cast to verify the router's `?? 120000` fallback.
- **Files modified:** `src/proxy/__tests__/router.test.ts`
- **Verification:** `npx tsc --noEmit` exits 0
- **Committed in:** edd70ec (Task 3 feat commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 blocking issues)
**Impact on plan:** Both auto-fixes necessary for correct test execution and TypeScript compilation. No scope creep.

## Issues Encountered
- Vitest fake timers with vi.useFakeTimers() required careful handling for async timeout testing -- the mock fetch needed to listen for AbortSignal abort events rather than relying on setTimeout chains. Resolved by making the mock signal-aware.
- Zod's `.default()` makes fields required in the output type (Config), which caused TypeScript errors in test data construction. Resolved by adding explicit values to test objects.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness
- Proxy pipeline core complete: config with timeout, model slot resolution, upstream HTTP execution
- Ready for Plan 02-02: Fastify route handlers consuming ResolvedSlot and executeUpstream
- All contracts (types, interfaces, function signatures) established for downstream consumers
- No blockers

---
*Phase: 02-core-proxy-pipeline*
*Completed: 2026-05-11*
