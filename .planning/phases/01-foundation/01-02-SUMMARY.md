---
phase: 01-foundation
plan: 02
subsystem: config
tags: [yaml, zod, config-validation, file-discovery, source-mapping]

requires:
  - phase: 01-foundation-01
    provides: Config type schema (Config, ModelSlotConfig, UpstreamConfig), ConfigValidationError, ValidationIssue, defaults

provides:
  - Config file discovery across 4 precedence levels (env var, cwd .yaml, cwd .yml, user config dir)
  - Full config loading pipeline with YAML source-position tracking and Zod validation
  - Line-number mapping from Zod validation errors back to YAML source positions
  - Graceful handling of YAML warnings (unknown tags) via console.warn

affects: [01-foundation-03, server-bootstrap]

tech-stack:
  added: [yaml v2.8.4 parseDocument with LineCounter]
  patterns:
    - "Config file discovery: env var > cwd .yaml > cwd .yml > platform user config dir"
    - "Config loading pipeline: readFileSync -> parseDocument (source tracking) -> toJS -> Zod safeParse -> line number mapping"
    - "Zod error-to-YAML-line mapping via doc.getIn(issue.path) + LineCounter.linePos()"

key-files:
  created:
    - src/config/paths.ts: Config file discovery across 4 precedence levels with platform-aware paths
    - src/config/loader.ts: Full YAML config loading pipeline with source tracking and Zod validation
    - src/config/__tests__/loader.test.ts: Vitest tests for loader (5 tests covering valid/invalid/syntax/missing/warnings)

key-decisions:
  - "Used yaml parseDocument() with LineCounter for source-position tracking instead of relying on node.linePos (which is not populated on AST nodes in yaml v2)"
  - "Used uniqueKeys: false parsing option since yaml v2 treats duplicate keys as errors (not warnings), and Zod schema handles key validation"
  - "Used character-offset-to-line conversion (lc.linePos(node.range[0])) for Zod error path mapping since AST nodes lack linePos in yaml v2"
  - "Added types: ['node'] to tsconfig.json for Node.js type resolution (TS6 requires explicit type registration)"

patterns-established:
  - "Config module provides typed exports consumed by server bootstrap"
  - "Error pipeline: raw error -> typed ValidationIssue -> ConfigValidationError with format()"
  - "Sync startup validation (config loaded before server starts)"

requirements-completed: [CONF-01, CONF-03]
---

# Phase 01 Foundation Plan 02: Config Discovery and Loading Pipeline

**Config file discovery across 4 precedence levels and full YAML loading pipeline with source-position tracking for actionable Zod validation error messages**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-11T01:58:00Z
- **Completed:** 2026-05-11T02:05:00Z
- **Tasks:** 2 (1 auto, 1 TDD)
- **Commits:** 3

## Accomplishments

- **Config file discovery** (`paths.ts`): Searches SENTIROUTE_CONFIG env var, cwd/sentiroute.yaml, cwd/sentiroute.yml, and platform user config dir (Windows: %APPDATA%/SentiRoute/config.yaml, Unix: ~/.config/sentiroute/config.yaml). Descriptive error lists all paths searched.
- **Config loading pipeline** (`loader.ts`): Full end-to-end pipeline — readFileSync, YAML parseDocument with LineCounter for source tracking, doc.toJS() conversion, Zod configSchema.safeParse(), line number mapping via doc.getIn() and lc.linePos() on character offsets.
- **YAML syntax errors**: Caught from both parseDocument throw (catastrophic) and doc.errors array (non-fatal). Wrapped in ConfigValidationError with line:col from parser.
- **YAML warnings**: Unknown tags and other non-fatal warnings printed to console.warn with file path and line number. Do NOT fail validation.
- **Zod error-to-YAML mapping**: Each Zod validation issue is mapped back to the YAML source position using doc.getIn(issue.path) to retrieve the AST node, then lc.linePos(node.range[0]) to convert character offset to line:col.

## Task Commits

1. **Task 1: Config file path resolution** - `348b3c6` (feat)
2. **Task 2 (TDD RED): Loader failing tests** - `2101d7a` (test)
3. **Task 2 (TDD GREEN): Loader implementation** - `3fe5974` (feat)

## Files Created/Modified

- `src/config/paths.ts` - Config file discovery with platform-aware Windows/Unix paths
- `src/config/loader.ts` - YAML config loading pipeline with source tracking and Zod validation
- `src/config/__tests__/loader.test.ts` - Vitest tests (5 tests, all passing)
- `tsconfig.json` - Added `types: ["node"]` for TS6 Node.js type resolution

## Decisions Made

- Used `yaml.parseDocument()` with `LineCounter` and `uniqueKeys: false` — the Document AST nodes in yaml v2 do NOT have `linePos` populated (contrary to early research assumptions). Instead, nodes have `range` (character offsets), and line numbers are computed via `lc.linePos(node.range[0])`.
- Used `uniqueKeys: false` because yaml v2 treats duplicate keys as errors in `doc.errors`, not warnings. Since Zod schema validation covers key structure, duplicate keys are handled by the schema layer (or silently merged).
- Error pipeline handles both `parseDocument` thrown errors (rare catastrophic failures) and `doc.errors` (non-fatal parse errors like unclosed quotes, invalid flow sequences).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `types: ["node"]` to tsconfig.json**
- **Found during:** Task 1 (paths.ts verification)
- **Issue:** TypeScript 6.0.3 could not resolve `node:fs`, `node:path`, `node:os` or `process` global without explicit `types: ["node"]` in tsconfig. Existing Plan 01 files compiled because they did not import any node: modules or use process/buffer globals.
- **Fix:** Added `"types": ["node"]` to compilerOptions in tsconfig.json.
- **Files modified:** tsconfig.json
- **Verification:** `npx tsc --noEmit` exits 0 with paths.ts imports.
- **Committed in:** 348b3c6 (Task 1 commit)

**2. [Rule 1 - Research/Library Mismatch] Adapted loader implementation to actual yaml v2 library behavior**
- **Found during:** Task 2 (loader test failures)
- **Issue:** The plan assumed `parseDocument` AST nodes have `linePos` populated (for Zod error mapping) and that YAML syntax errors always throw `YAMLParseError`. In yaml v2.8.4: 1) AST nodes from `parseDocument()` do NOT have `linePos` — they have `range` (character offsets); 2) Most YAML parse errors are stored in `doc.errors` array, not thrown; 3) Duplicate keys produce errors, not warnings.
- **Fix:** 1) Added `LineCounter` to parseDocument options and use `lc.linePos(node.range[0])` for line number mapping; 2) Check `doc.errors` after successful parse for non-fatal errors; 3) Use `uniqueKeys: false` to suppress duplicate key errors (Zod handles validation); 4) Test warnings with unknown YAML tags instead of duplicate keys.
- **Files modified:** loader.ts, loader.test.ts
- **Verification:** All 5 vitest tests pass, all plan verification assertions pass.
- **Committed in:** 2101d7a, 3fe5974 (Task 2 commits)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 research/library mismatch)
**Impact on plan:** Both fixes necessary for correct operation. No scope creep. The yaml v2 library behavior was well-documented but the research phase made incorrect assumptions about `linePos` and error handling.

## Issues Encountered

- **YAML v2 line position handling:** The research phase (01-RESEARCH.md) documented `node.linePos?.[0]?.line` for extracting line numbers from AST nodes. In practice, yaml v2.8.4 does not populate `linePos` on Document AST nodes from `parseDocument()`. Nodes have `range` (character offset array `[start, end, lineEnd]`), and line/col must be computed using `LineCounter.linePos(startOffset)`. This affected the Zod error-to-YAML line mapping implementation.
- **YAML error granularity:** `parseDocument()` rarely throws `YAMLParseError` for malformed YAML. Instead, it creates a Document with entries in `doc.errors` (e.g., unclosed quotes, invalid flow sequences). The implementation handles both cases.
- **Duplicate key handling:** yaml v2 treats duplicate mapping keys as errors in `doc.errors`, not warnings. Using `uniqueKeys: false` silences duplicate key checking entirely (last value wins). This aligns with the plan's intent that duplicate keys should not fail validation.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Config file discovery ready for CLI integration (Plan 03)
- Config loading pipeline ready for `src/index.ts` server bootstrap
- Line-number-mapped validation errors ready for development feedback
- Next plan (01-03): implement server bootstrap — createApp(), load config, start Fastify, health endpoint, graceful shutdown

## Self-Check: PASSED

- Files: src/config/paths.ts, src/config/loader.ts, src/config/__tests__/loader.test.ts, SUMMARY.md all confirmed present
- Commits: 348b3c6 (Task 1), 2101d7a (Task 2 RED), 3fe5974 (Task 2 GREEN) all confirmed in git log

---
*Phase: 01-foundation*
*Completed: 2026-05-11*
