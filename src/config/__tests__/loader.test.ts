import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ConfigValidationError } from '../errors.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let fixturesDir: string;

beforeAll(() => {
  fixturesDir = mkdtempSync(join(tmpdir(), 'sr-loader-test-'));
});

afterAll(() => {
  rmSync(fixturesDir, { recursive: true, force: true });
});

function f(name: string): string {
  return join(fixturesDir, name);
}

describe('loadConfig', () => {
  it('loads a valid YAML config and returns a typed Config object', async () => {
    const { loadConfig } = await import('../loader.js');
    writeFileSync(f('valid.yaml'), `
server:
  port: 3491
  host: 0.0.0.0
model_slots:
  claude-opus-4-7:
    model: claude-opus-4-7
    upstreams:
      - endpoint: https://api.anthropic.com/v1
        api_key: sk-ant-test123
        upstream_model: claude-opus-4-7
        format: anthropic
      - endpoint: https://openrouter.ai/api/v1
        api_key: sk-or-test456
        upstream_model: anthropic/claude-opus-4-7
        format: openai
`);
    const config = loadConfig(f('valid.yaml'));
    expect(config.server.port).toBe(3491);
    expect(config.server.host).toBe('0.0.0.0');
    expect(Object.keys(config.model_slots)).toHaveLength(1);
    expect(config.model_slots['claude-opus-4-7'].upstreams[0].format).toBe('anthropic');
    expect(config.model_slots['claude-opus-4-7'].upstreams[1].format).toBe('openai');
    expect(config._configPath).toContain('valid.yaml');
  });

  it('throws ConfigValidationError with line number for invalid port type', async () => {
    const { loadConfig } = await import('../loader.js');
    writeFileSync(f('bad-port.yaml'), `
server:
  port: abc
model_slots:
  opus:
    model: claude-opus-4-7
    upstreams:
      - endpoint: https://api.anthropic.com/v1
        api_key: sk-test
        upstream_model: claude-opus-4-7
        format: anthropic
`);
    try {
      loadConfig(f('bad-port.yaml'));
      expect.unreachable('Should have thrown');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      expect((e as ConfigValidationError).name).toBe('ConfigValidationError');
      expect((e as ConfigValidationError).issues.length).toBeGreaterThan(0);
      expect((e as ConfigValidationError).issues[0].filePath).toContain('bad-port');
      expect(typeof (e as ConfigValidationError).issues[0].line).toBe('number');
    }
  });

  it('throws ConfigValidationError with line/col for YAML syntax errors', async () => {
    const { loadConfig } = await import('../loader.js');
    // Unclosed double quote triggers a YAML parse error in doc.errors
    writeFileSync(f('syntax-error.yaml'), 'key: "unclosed\nmore: stuff');
    try {
      loadConfig(f('syntax-error.yaml'));
      expect.unreachable('Should have thrown');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      expect((e as ConfigValidationError).name).toBe('ConfigValidationError');
      const fmt = (e as ConfigValidationError).format();
      expect(fmt).toContain('YAML');
      // Should have line number info for syntax errors
      expect(typeof (e as ConfigValidationError).issues[0].line).toBe('number');
    }
  });

  it('throws ConfigValidationError for missing/unreadable file', async () => {
    const { loadConfig } = await import('../loader.js');
    try {
      loadConfig(f('does-not-exist.yaml'));
      expect.unreachable('Should have thrown');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      expect((e as ConfigValidationError).name).toBe('ConfigValidationError');
      expect((e as Error).message).toContain('Cannot read');
    }
  });

  it('prints console.warn for YAML warnings (unknown tags) but still loads', async () => {
    const { loadConfig } = await import('../loader.js');
    // Unknown YAML tags produce warnings but don't prevent loading
    writeFileSync(f('warning-tags.yaml'), `
server:
  port: 3000
  host: !weird 0.0.0.0
model_slots:
  opus:
    model: claude-opus-4-7
    upstreams:
      - endpoint: !bad https://api.anthropic.com/v1
        api_key: sk-test
        upstream_model: claude-opus-4-7
        format: anthropic
`);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = loadConfig(f('warning-tags.yaml'));
    expect(warnSpy).toHaveBeenCalled();
    expect(config.server.port).toBe(3000);
    warnSpy.mockRestore();
  });
});
