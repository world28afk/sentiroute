# Phase 1: Foundation - Research

**Researched:** 2026-05-11
**Domain:** Node.js/TypeScript project initialization, HTTP server bootstrap, YAML config loading with schema validation
**Confidence:** HIGH

## Summary

Phase 1 establishes the project skeleton and a bootable server. It must deliver three things: a TypeScript project that starts with `npm start`, a `GET /health` endpoint returning server status and upstream configuration, and a config loader that validates a YAML file at startup with clear, actionable error messages. No proxy logic, no format translation, no sentiment analysis -- just the foundation that all later phases build on.

The stack is locked: Node.js 24 + TypeScript 6.0 + Fastify 5.8 + yaml 2.8 + zod 4.4 + pino 10.3. The key research question is how to produce high-quality validation errors from YAML config files -- specifically, mapping Zod validation failures back to YAML line numbers. This is achievable using `yaml`'s `parseDocument()` API which tracks source positions in its AST nodes, combined with Zod error path traversal. The approach is documented in the Code Examples section.

Windows path handling matters: the project runs on Windows (confirmed: Node 24.13.0, npm 11.6.2 on Windows 10). Config file discovery must use `%APPDATA%` for user config dir, not `~/.config`. File paths in error messages should use the actual path format (backslashes on Windows are fine).

**Primary recommendation:** Use `yaml.parseDocument()` for source-position tracking, then Zod v4 for schema validation, and wire Zod error paths back through the YAML Document AST to extract line numbers. Combine into a `ValidationError` type that includes file path, line number, field path, expected type, and actual value.

## User Constraints (from CONTEXT.md)

### Locked Decisions

The following come from STACK.md and CLAUDE.md which serve as the project decisions:
- **Runtime:** Node.js 18+ (confirmed: Node 24.13.0 locally)
- **Language:** TypeScript 6.0.3 (latest stable as of 2026-04-16)
- **HTTP Framework:** Fastify 5.8.5 (over Express or Hono, per STACK.md comparisons)
- **Config format:** YAML (yaml 2.8.4) + Zod validation (zod 4.4.3)
- **HTTP client:** Native Node.js fetch (no axios/got/undici)
- **Logging:** pino 10.3.1 (not winston)
- **State persistence (later):** conf 15.1.0 (not SQLite, not raw JSON)
- **Build tools:** tsup 8.5.1 (bundling), tsx 4.21.0 (dev runner), vitest 4.1.5 (testing)
- **Format translation:** Custom TypeScript (no Vercel AI SDK)
- **Sentiment analysis:** Custom keyword/heuristic (no NLP libraries)
- **Deployment:** `npm install -g` or run from source
- **API surface:** Must be Anthropic Messages API compatible + OpenAI Chat Completions compatible
- **Performance:** Proxy overhead < 50ms added latency

### Claude's Discretion
- Config file search paths (order of precedence, default locations)
- Health endpoint response schema (which fields, naming conventions)
- Project directory structure (naming, organization within the skeleton)
- Error message format for config validation (text structure, line number display)
- Startup logging format (info-level messages at boot)
- package.json scripts beyond `start` (dev, build, test)

### Deferred Ideas (OUT OF SCOPE)
- Quota/rate-limit tracking (9router owns this)
- Web/GUI dashboard (CLI-only tool)
- Built-in provider integrations (users bring upstreams)
- Multi-user / multi-tenant
- Load balancing / round-robin
- Request caching
- Token compression (RTK)
- Cloud sync
- OAuth token management

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CORE-03 | GET /health returns JSON with server status, uptime, active upstream per model slot | Fastify 5.8 route registration with `reply.send()` returns JSON natively. Active upstream is always "primary" in Phase 1 (no switching yet). Uptime computed from `process.uptime()`. |
| CONF-01 | YAML config file with per-model-slot upstream endpoints, API keys, model name mapping | yaml 2.8.4 parses config file. Config schema defined via zod 4.4.3. Structure: `server.port`, `server.host`, `model_slots.<id>.model`, `model_slots.<id>.primary.{endpoint,api_key,upstream_model,format}`, `model_slots.<id>.backup.{...}`. |
| CONF-03 | Config validated on load with clear error messages (file path, line number, expected vs actual) | Two-tier validation: (1) yaml.parseDocument() catches YAML syntax errors with line/col, (2) Zod validates schema, error paths mapped back to YAML line numbers via Document AST traversal using `doc.getIn(path, true)` which returns nodes with `linePos` field. Results in `ConfigValidationError` with all required fields. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 24.13.0 | Runtime | Active LTS, built-in fetch, Web Streams API, `fs.promises`. Verified locally. |
| TypeScript | 6.0.3 | Language | Latest stable (2026-04-16). Improved type inference, const type parameters, faster compilation. |
| Fastify | 5.8.5 | HTTP framework | Zero-overhead schema serialization, built-in JSON body parsing, streaming support, plugin ecosystem, TypeScript-first. Published 2026-04-14. |
| pino | 10.3.1 | Structured logging | Fastest JSON logger for Node.js. Fastify has built-in pino integration via `Fastify({ logger: true })`. Published 2026-02-09. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| yaml | 2.8.4 | YAML config file parsing | Parse `sentiroute.yaml` at startup. Use `parseDocument()` for source-position tracking. Published 2026-05-02. |
| zod | 4.4.3 | Config schema validation | Define config TypeScript types via `z.object()`. Infer types with `z.infer`. Validate parsed config. Published 2026-02. |
| tsup | 8.5.1 | TypeScript bundler | Build `src/` to `dist/` for production. Simple config, fast esbuild-based bundling. |
| tsx | 4.21.0 | TypeScript execution | Run TypeScript directly in development via `tsx src/index.ts`. |
| vitest | 4.1.5 | Test runner | Fast vitest-native runner if tests are added. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Fastify 5.8 | Express 5.2 | Fastify is 2-3x faster JSON serialization, better TypeScript DX, streaming backpressure. Express 5 lost ecosystem momentum. |
| Fastify 5.8 | Hono 4.12 | Hono is edge-compute focused, no benefit for local proxy. Fewer plugins. |
| Fastify 5.8 | Node `http.createServer` | Raw http loses body parsing, schema validation, route structure. Viable for 2-route proxy but no extensibility. |
| yaml 2.8 + zod 4.4 | cosmiconfig | Cosmiconfig searches 10+ locations unnecessarily. Single known config path is sufficient. |
| yaml 2.8 + zod 4.4 | TOML | Less standard than YAML for developer CLI tools. |
| yaml 2.8 + zod 4.4 | .env only | Env vars insufficient for complex config (multiple upstreams per slot, per-upstream keys). |
| pino 10.3 | winston | Winston is heavier, slower, more complex config. Pino is standard for Node.js HTTP services. |

**Installation:**
```bash
# Core dependencies for Phase 1
npm install fastify@5.8.5
npm install yaml@2.8.4
npm install zod@4.4.3
npm install pino@10.3.1

# Dev dependencies
npm install -D typescript@6.0.3
npm install -D tsx@4.21.0
npm install -D tsup@8.5.1
npm install -D @types/node@25.6.2
npm install -D vitest@4.1.5
```

**Version verification:** All versions above were verified against npm registry on 2026-05-11. No `@anthropic-ai/sdk` or `openai` are needed for Phase 1 (those are for format translation in Phase 3). No `conf` is needed for Phase 1 (state comes in Phase 4).

## Architecture Patterns

### Recommended Project Structure

```
sentiroute/
|-- package.json              # name: "sentiroute", type: "module"
|-- tsconfig.json             # target: ES2022, module: NodeNext, strict: true
|-- tsup.config.ts            # entry: src/index.ts, format: esm, target: node18
|-- .gitignore
|-- src/
|   |-- index.ts              # Entry: create Fastify, load config, start listening
|   |-- config/
|   |   |-- loader.ts         # Read YAML file, validate with Zod, return Config
|   |   |-- schema.ts         # Zod schemas + inferred TypeScript types
|   |   |-- defaults.ts       # Default config values
|   |   |-- errors.ts         # ConfigValidationError type + formatting
|   |-- server/
|   |   |-- app.ts            # Fastify app factory (creates, registers routes, returns)
|   |   |-- routes/
|   |       |-- health.ts     # GET /health handler
|   |-- types/
|   |   |-- index.ts          # Shared type re-exports
|   |-- utils/
|       |-- version.ts        # Package version from package.json
```

**Phase 1 only needs:** `src/index.ts`, `src/config/loader.ts`, `src/config/schema.ts`, `src/config/defaults.ts`, `src/config/errors.ts`, `src/server/app.ts`, `src/server/routes/health.ts`. The other module directories (`proxy/`, `sentiment/`, `translation/`, `state/`) can be stubs or created in later phases.

### Pattern 1: Config Loading Pipeline

**What:** Load YAML file -> validate syntax -> parse to object -> validate with Zod -> return typed Config or detailed error.

**When to use:** At server startup, before listening. Server must not start if config is invalid.

**Pipeline:**
```
1. Resolve config file path (search order with precedence)
2. Read file with fs.readFileSync (synchronous at startup)
3. Parse with yaml.parseDocument() -> Document (catches YAML syntax errors with line/col)
4. Convert Document to plain JS object via doc.toJS()
5. Validate JS object against Zod schema (catches type errors, missing fields)
6. On Zod error: walk Zod error paths back through Document AST to get line numbers
7. Return typed Config or throw ConfigValidationError
```

**Example:**
```typescript
// src/config/loader.ts
import { readFileSync } from 'node:fs';
import { parseDocument, YAMLParseError } from 'yaml';
import { configSchema, type Config } from './schema.js';
import { ConfigValidationError, type ValidationIssue } from './errors.js';

export function loadConfig(configPath: string): Config {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (err) {
    throw new ConfigValidationError(`Cannot read config file: ${configPath}`, [
      { message: (err as Error).message, filePath: configPath }
    ]);
  }

  // Step 1: Parse YAML with source position tracking
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(raw);
  } catch (err) {
    const yamlErr = err as YAMLParseError;
    throw new ConfigValidationError(`YAML syntax error in ${configPath}`, [
      {
        message: yamlErr.message,
        filePath: configPath,
        line: yamlErr.linePos?.[0]?.line,
        column: yamlErr.linePos?.[0]?.col,
      }
    ]);
  }

  // Warn on YAML warnings (duplicate keys, etc.)
  if (doc.warnings.length > 0) {
    for (const w of doc.warnings) {
      console.warn(`[YAML warning] ${configPath}:${w.linePos?.[0]?.line}: ${w.message}`);
    }
  }

  // Step 2: Convert to plain object
  const data = doc.toJS() as Record<string, unknown>;

  // Step 3: Validate with Zod
  const result = configSchema.safeParse(data);
  if (!result.success) {
    const issues: ValidationIssue[] = result.error.issues.map((issue) => {
      const path = issue.path.join('.');
      // Map Zod path back to YAML line number via Document AST
      const node = doc.getIn(issue.path, true);
      const line = node?.linePos?.[0]?.line;
      const col = node?.linePos?.[0]?.col;
      return {
        message: `${path}: ${issue.message}`,
        filePath: configPath,
        line,
        column: col,
        expected: issue.message.includes('Expected') ? extractExpected(issue.message) : undefined,
        received: issue.message.includes('Received') ? extractReceived(issue.message) : undefined,
      };
    });
    throw new ConfigValidationError(
      `Invalid config: ${configPath}`,
      issues,
    );
  }

  return result.data;
}
```

### Pattern 2: Fastify Server Factory with Health Endpoint

**What:** A clean Fastify server setup with the health route, pino logger, and async start.

**When to use:** Server bootstrap in `src/index.ts`.

```typescript
// src/server/app.ts
import Fastify from 'fastify';
import type { Config } from '../config/schema.js';
import { healthRoute } from './routes/health.js';

export function createApp(config: Config) {
  const app = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty', // optional, for dev readability
      },
    },
  });

  // Register routes
  app.register(healthRoute);

  return app;
}
```

```typescript
// src/server/routes/health.ts
import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../../config/schema.js';

const startTime = Date.now();

export const healthRoute: FastifyPluginAsync<{ config: Config }> = async (fastify, opts) => {
  fastify.get('/health', async (_request, _reply) => {
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    const modelSlots: Record<string, object> = {};

    for (const [slotId, slotConfig] of Object.entries(opts.config.model_slots)) {
      modelSlots[slotId] = {
        model: slotConfig.model,
        active_upstream: 'primary', // always primary in Phase 1
        primary: {
          endpoint: slotConfig.primary.endpoint,
          format: slotConfig.primary.format,
        },
        backup: slotConfig.backup
          ? { endpoint: slotConfig.backup.endpoint, format: slotConfig.backup.format }
          : null,
      };
    }

    return {
      status: 'ok',
      version: '0.1.0',
      uptime_seconds: uptimeSeconds,
      config_file: opts.config._configPath,
      model_slots: modelSlots,
    };
  });
};
```

### Anti-Patterns to Avoid

- **Starting server before config validation:** Config errors are startup errors. Validate config synchronously before calling `app.listen()`. Never boot a server that can't route.
- **Hardcoded config paths:** Accept `--config` CLI flag or `SENTIROUTE_CONFIG` env var. Print the resolved path at startup.
- **Silent config fallback:** If no config file found, fail with a clear message and example config path. Don't silently use defaults with no upstreams.
- **Raw `console.log` for config errors:** Use the structured error type (`ConfigValidationError`) so error messages are consistent and testable.
- **Using `require()` import for JSON:** Use `import` with `assert { type: 'json' }` or read with `fs` and parse. The project uses ESM (`"type": "module"`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing | Custom YAML parser | `yaml` 2.8.4 | YAML is surprisingly complex (anchors, aliases, multi-line strings, type resolution). The `yaml` package handles all edge cases, provides source-position tracking via `parseDocument()`. |
| JSON schema validation | Custom type-checking or `if/typeof` | `zod` 4.4.3 | Zod infers TypeScript types from runtime schemas, produces detailed error paths, handles nested objects, unions, optionals. Writing manual validation for a nested config shape is error-prone. |
| HTTP server | Raw `http.createServer` | Fastify 5.8 | Fastify provides body parsing, route registration, error handling, logging, schema serialization. Raw `http` needs manual body buffering, error handling, and route matching. |
| Signal handling | Manual process.on('SIGINT') | Fastify's `app.listen()` handles this | Fastify's `listen()` returns a promise and handles graceful shutdown. Manual signal handling is still needed for additional cleanup (e.g., flushing state in Phase 4+). |

## Common Pitfalls

### Pitfall 1: Config File Not Found / Wrong Path
**What goes wrong:** The server starts successfully but all requests fail with "no upstreams configured" because the config file wasn't found and empty defaults were used.
**Why it happens:** Silent fallback to defaults when config file doesn't exist.
**How to avoid:** Validate config file exists before starting. Use a clear search path order: `--config` flag > `SENTIROUTE_CONFIG` env var > `./sentiroute.yaml` (cwd) > `%APPDATA%/SentiRoute/config.yaml` (Windows) > `~/.config/sentiroute/config.yaml` (Unix).
**Warning signs:** Server starts on first run without any config. Health endpoint shows empty model_slots.

### Pitfall 2: Zod Error Paths Don't Match YAML Line Numbers
**What goes wrong:** Validation error says "field 'port' must be a number" but doesn't say which line.
**Why it happens:** Direct `yaml.parse()` produces a plain object with no source info. Zod validates the object. The error path exists but can't be mapped back to the file.
**How to avoid:** Use `yaml.parseDocument()` which returns a `Document` with source-position tracking on all nodes. Store the document reference. On Zod error, use `doc.getIn(issue.path, true)` to get the node with `linePos` info.
**Warning signs:** Validation error messages that lack line numbers early in development.

### Pitfall 3: YAML Type Coercion Surprises
**What goes wrong:** YAML parses `port: 3000` as a number (correct), but `api_key: 12345` also parses as a number (wrong -- should be string). API keys that look like numbers get silently corrupted.
**Why it happens:** YAML auto-detects types. Any value that looks numeric gets parsed as a number unless quoted.
**How to avoid:** Zod catches this at validation time -- `z.string()` rejects numbers. But this means the user sees a validation error for a value they thought was correct. Mitigation: in the error message, show what YAML parsed the value as. The `yaml` doc preserves the original string representation.
**Warning signs:** "Expected string, received number" errors for API keys. User didn't quote their key.

### Pitfall 4: Windows Path Handling
**What goes wrong:** Config file discovery uses Unix paths (`~/.config/sentiroute/`) and fails on Windows. Error messages show forward-slash paths that don't match Windows conventions.
**Why it happens:** `os.homedir()` works on both platforms, but `~/.config` is a Unix convention.
**How to avoid:** Use `os.homedir()` for home directory detection. Use `path.join()` for all path construction. Use `process.env['APPDATA']` on Windows for the user config directory. The `yaml` library and `fs` module handle cross-platform paths correctly.
**Warning signs:** Config file not found on Windows. Error messages with Unix-only paths.

### Pitfall 5: Port Already in Use
**What goes wrong:** EADDRINUSE error when another process (or a previous SentiRoute instance) is already on the configured port.
**Why it happens:** Default port 3000 is commonly used by Node.js hot-reload servers, React dev servers, and other tools.
**How to avoid:** Default to an uncommon port (e.g., 3571 or 3100). Catch EADDRINUSE and print a clear message: `Port 3000 is in use by PID 1234. Use SENTIROUTE_PORT=<port> or set port in config.`
**Warning signs:** Server crashes on startup with EADDRINUSE on first run.

## Code Examples

### Project Initialization (package.json)

```json
{
  "name": "sentiroute",
  "version": "0.1.0",
  "description": "Sentiment-driven AI upstream adapter",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "sentiroute": "dist/index.js"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "fastify": "^5.8.5",
    "yaml": "^2.8.4",
    "zod": "^4.4.3",
    "pino": "^10.3.1"
  },
  "devDependencies": {
    "typescript": "^6.0.3",
    "tsx": "^4.21.0",
    "tsup": "^8.5.1",
    "@types/node": "^25.6.2",
    "vitest": "^4.1.5"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src/**/*"]
}
```

### Config Schema (Zod v4)

```typescript
// src/config/schema.ts
import { z } from 'zod/v4';

const upstreamConfigSchema = z.object({
  endpoint: z.string().url('Must be a valid URL'),
  api_key: z.string().min(1, 'API key is required'),
  upstream_model: z.string().min(1, 'Upstream model name is required'),
  format: z.enum(['anthropic', 'openai']),
});

const modelSlotSchema = z.object({
  model: z.string().min(1, 'Model name is required'),
  primary: upstreamConfigSchema,
  backup: upstreamConfigSchema.optional(),
});

export const configSchema = z.object({
  _configPath: z.string().optional(), // internal, not from YAML
  server: z.object({
    port: z.coerce.number().int().positive().default(3000),
    host: z.string().default('127.0.0.1'),
  }).default({}),
  model_slots: z.record(modelSlotSchema).refine(
    (slots) => Object.keys(slots).length > 0,
    { message: 'At least one model slot is required' }
  ),
});

export type Config = z.infer<typeof configSchema>;
export type ModelSlotConfig = z.infer<typeof modelSlotSchema>;
export type UpstreamConfig = z.infer<typeof upstreamConfigSchema>;
```

### Config Validation With Line Numbers

```typescript
// src/config/errors.ts
export interface ValidationIssue {
  message: string;
  filePath: string;
  line?: number;
  column?: number;
  expected?: string;
  received?: string;
}

export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: ValidationIssue[],
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }

  format(): string {
    const lines: string[] = [this.message];
    for (const issue of this.issues) {
      const location = issue.line
        ? `:${issue.line}${issue.column ? `:${issue.column}` : ''}`
        : '';
      const detail = issue.expected
        ? ` (expected: ${issue.expected}, received: ${issue.received})`
        : '';
      lines.push(`  ${issue.filePath}${location}: ${issue.message}${detail}`);
    }
    return lines.join('\n');
  }
}
```

### Startup Sequence (src/index.ts)

```typescript
// src/index.ts
import { loadConfig } from './config/loader.js';
import { createApp } from './server/app.js';
import { resolveConfigPath } from './config/paths.js';

function main(): void {
  const configPath = resolveConfigPath();
  const config = loadConfig(configPath);

  const app = createApp({ config });

  app.listen({ port: config.server.port, host: config.server.host }, (err, address) => {
    if (err) {
      app.log.error(err, 'Failed to start server');
      process.exit(1);
    }
    app.log.info(`SentiRoute v0.1.0 started on ${address}`);
    app.log.info(`Config loaded: ${configPath}`);
    app.log.info(`Model slots: ${Object.keys(config.model_slots).join(', ')}`);
  });
}

main();
```

### Config File Discovery

```typescript
// src/config/paths.ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

export function resolveConfigPath(): string {
  // Precedence: CLI flag > env var > cwd > user config dir
  // (CLI flag parsing would go here if implemented)

  const envPath = process.env['SENTIROUTE_CONFIG'];
  if (envPath && existsSync(envPath)) return envPath;

  const cwdPath = join(process.cwd(), 'sentiroute.yaml');
  if (existsSync(cwdPath)) return cwdPath;

  const cwdYmlPath = join(process.cwd(), 'sentiroute.yml');
  if (existsSync(cwdYmlPath)) return cwdYmlPath;

  // User config directory
  const userDir = platform() === 'win32'
    ? join(process.env['APPDATA'] || join(homedir(), 'AppData', 'Roaming'), 'SentiRoute')
    : join(homedir(), '.config', 'sentiroute');

  const userPath = join(userDir, 'config.yaml');
  if (existsSync(userPath)) return userPath;

  throw new Error(
    `No config file found. Create a sentiroute.yaml file or set SENTIROUTE_CONFIG.\n` +
    `Searched:\n` +
    `  - ${envPath ? envPath : '(SENTIROUTE_CONFIG not set)'}\n` +
    `  - ${cwdPath}\n` +
    `  - ${cwdYmlPath}\n` +
    `  - ${userPath}`
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express.js for HTTP | Fastify 5.x | Standard shift 2023-2025 | Fastify is 2-3x faster JSON serialization, TypeScript-first, better streaming. |
| TypeScript 5.x | TypeScript 6.0 | 2026-04 | Improved type inference, const type parameters, faster compilation. `tsconfig.json` needs `target: ES2022`. |
| `node-fetch` package | Native `fetch` | Node 18+ (2023) | No dependency needed. Available globally. |
| Zod 3.x | Zod 4.x | 2026-02 | Improved error messages, smaller bundle, `zod/v4` import path. Breaking changes from v3. |

**Important:** Zod 4 uses `import { z } from 'zod/v4'` rather than `'zod'`. The `'zod'` and `'zod/v3'` paths provide v3 compat. Phase 1 should target v4 explicitly.

**Deprecated/outdated:**
- `node-fetch`: Deprecated since Node 18 made `fetch` global. Do not install.
- Express.js: Declining ecosystem momentum. Fastify is standard for new Node.js HTTP projects.
- `ts-node`: tsx is faster (uses esbuild under the hood) and doesn't require separate `tsconfig-paths` setup.

## Open Questions

1. **Config file extension convention: `.yaml` vs `.yml`?**
   - What we know: Both are common. yaml library reads both.
   - What's unclear: Which should be the default/recommended extension in docs and discovery.
   - Recommendation: Support both in discovery (check `.yaml` first, then `.yml`). Use `.yaml` in documentation as the canonical extension.

2. **pino-pretty for dev vs JSON for production?**
   - What we know: pino outputs JSON by default. `pino-pretty` makes it human-readable in dev.
   - What's unclear: Should `npm run dev` use pino-pretty? Should `npm start` use raw JSON?
   - Recommendation: Let Fastify's logger config handle this. Default to JSON for start, add pino-pretty only in dev script. Add `pino-pretty` to devDependencies (or not -- `transport.target` works with any installed module).

3. **CLI flag parsing for `--config`?**
   - What we know: Config file path can come from env var or default search.
   - What's unclear: Should Phase 1 include CLI flag parsing (even minimal with `process.argv`)?
   - Recommendation: Skip CLI flag parsing in Phase 1. Use env var + search paths only. Add CLI parsing later via a library like `cac` or `commander` when the CLI commands need it. For Phase 1, `--config` can be set via `SENTIROUTE_CONFIG` env var.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | 24.13.0 | -- |
| npm | Package management | Yes | 11.6.2 | -- |
| git | Version control | Yes | 2.52.0 | -- |
| TypeScript (tsc) | Type checking | No | -- | Install via `npm install -D typescript` |
| tsx | Dev execution | No | -- | Install via `npm install -D tsx` |
| tsup | Production build | No | -- | Install via `npm install -D tsup` |

**Missing dependencies with no fallback:** None. All are npm-installable devDependencies.

**Missing dependencies with fallback:** None. Everything needed is an npm package.

## Sources

### Primary (HIGH confidence)
- Fastify v5.8.5: npm registry verified (published 2026-04-14). TypeScript-first with `fastify.d.ts`.
- TypeScript 6.0.3: npm registry verified (dist-tag `latest`, published 2026-04-16).
- yaml 2.8.4: npm registry verified (published 2026-05-02). `parseDocument()` supports `linePos` tracking via Document AST nodes.
- zod 4.4.3: npm registry verified. v4 has `zod/v4` import path, improved error messages, `.safeParse()` returns discriminated union.
- pino 10.3.1: npm registry verified (published 2026-02-09). Fastify built-in integration.
- Node.js v24.13.0: Verified locally (Windows 10).
- STACK.md: Full stack analysis with justification for every dependency choice.
- ARCHITECTURE.md: Verified architecture against 9router and Portkey Gateway codebases.
- PITFALLS.md: Phase-specific pitfalls documented with mitigations.

### Secondary (MEDIUM confidence)
- Fastify Getting Started guide: Standard patterns for route registration, TypeScript usage, logger configuration. Verified against npm README.
- yaml library API: `parseDocument()` returns Document with `getIn(path, keepNode)` for position-aware node access. Verified via npm exports.
- Zod v4 migration guide: Breaking changes from v3, new error format API. Verified via npm exports showing `./v4` path.

### Tertiary (LOW confidence)
- Windows `%APPDATA%` path conventions: Standard practice for Windows config file locations. Not yet verified against actual Windows SentiRoute usage.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all versions npm-verified on 2026-05-11. STACK.md provides comprehensive rationale.
- Architecture: HIGH - project structure follows Fastify conventions and standard TypeScript patterns. Config loading pipeline is a well-known pattern.
- Pitfalls: HIGH - Windows path handling and config discovery issues are well-understood. Zod+YAML line mapping is a known pattern from the yaml library documentation.
- Code examples: MEDIUM - patterns are standard but Zod v4 API specifics (exact import paths, error shape) should be verified during implementation since web access was unavailable for live docs.

**Research date:** 2026-05-11
**Valid until:** ~2026-06-11 (30 days) - stack versions are stable, but npm packages can release breaking changes.
