import { readFileSync } from 'node:fs';
import { parseDocument, LineCounter, YAMLParseError } from 'yaml';
import { configSchema, type Config } from './schema.js';
import { ConfigValidationError, type ValidationIssue } from './errors.js';

function extractExpected(message: string): string | undefined {
  const match = message.match(/Expected\s+(.+?)(?:,\s+received|$)/);
  return match?.[1];
}

function extractReceived(message: string): string | undefined {
  const match = message.match(/received\s+(.+?)$/);
  return match?.[1];
}

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
  // uniqueKeys: false because duplicate keys are non-fatal — Zod validation catches schema issues
  // LineCounter enables converting character offsets to line:col positions
  const lc = new LineCounter();
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(raw, { lineCounter: lc, uniqueKeys: false });
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

  // Handle non-fatal YAML parse errors (e.g. unclosed quotes, invalid flow sequences)
  if (doc.errors.length > 0) {
    const issues: ValidationIssue[] = doc.errors.map((err) => ({
      message: err.message,
      filePath: configPath,
      line: err.linePos?.[0]?.line,
      column: err.linePos?.[0]?.col,
    }));
    throw new ConfigValidationError(`YAML syntax error in ${configPath}`, issues);
  }

  // Warn on YAML warnings (unknown tags, etc.) but do not fail validation
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
      // doc.getIn returns the AST node with character offset range, but not linePos
      // Convert the character offset to line:col using the LineCounter
      const node = doc.getIn(issue.path, true);
      let line: number | undefined;
      let col: number | undefined;
      if (node?.range) {
        const pos = lc.linePos(node.range[0]);
        line = pos.line;
        col = pos.col;
      }
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

  // Set the config file path on the result so downstream code can display it
  result.data._configPath = configPath;

  return result.data;
}
