import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { writeConfig } from '../writer.js';
import type { Config } from '../schema.js';

function tempDir(): string {
  const name = `sentiroute-writer-test-${randomBytes(6).toString('hex')}`;
  const dir = join(tmpdir(), name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const MINIMAL_CONFIG: Config = {
  server: { port: 3000, host: '127.0.0.1' },
  model_slots: {
    opus: {
      model: 'claude-opus-4-7',
      upstreams: [
        {
          endpoint: 'https://api.anthropic.com/v1',
          api_key: 'sk-ant-test-key-here',
          upstream_model: 'claude-opus-4-7',
          format: 'anthropic',
        },
      ],
    },
  },
};

describe('writeConfig', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = tempDir();
    filePath = join(dir, 'sentiroute.yaml');
  });

  afterEach(() => {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes a valid YAML file to disk', async () => {
    await writeConfig(filePath, MINIMAL_CONFIG);
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('does not include _configPath in the output', async () => {
    const configWithPath: Config = {
      ...MINIMAL_CONFIG,
      _configPath: '/some/arbitrary/path.yaml',
    };
    await writeConfig(filePath, configWithPath);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).not.toContain('_configPath');
  });

  it('preserves model_slots section', async () => {
    await writeConfig(filePath, MINIMAL_CONFIG);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('model_slots');
    expect(content).toContain('opus:');
    expect(content).toContain('claude-opus-4-7');
  });

  it('preserves server section', async () => {
    await writeConfig(filePath, MINIMAL_CONFIG);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('server:');
    expect(content).toContain('port: 3000');
    expect(content).toContain('host:');
  });

  it('preserves sentiment section when present', async () => {
    const configWithSentiment: Config = {
      ...MINIMAL_CONFIG,
      sentiment: {
        threshold: 0.7,
        decayRate: 0.15,
        cooldownMs: 600000,
        antiFlapMs: 120000,
      },
    };
    await writeConfig(filePath, configWithSentiment);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('sentiment:');
    expect(content).toContain('threshold: 0.7');
    expect(content).toContain('cooldownMs: 600000');
  });

  it('serializes api_key as plain string (unquoted)', async () => {
    await writeConfig(filePath, MINIMAL_CONFIG);
    const content = readFileSync(filePath, 'utf-8');
    // api_key should appear as a plain scalar without surrounding quotes
    expect(content).toMatch(/api_key: sk-/);
  });

  it('handles multiple upstreams per slot', async () => {
    const config: Config = {
      server: { port: 3000, host: '127.0.0.1' },
      model_slots: {
        opus: {
          model: 'claude-opus-4-7',
          upstreams: [
            {
              endpoint: 'https://api.anthropic.com/v1',
              api_key: 'sk-ant-primary',
              upstream_model: 'claude-opus-4-7',
              format: 'anthropic',
            },
            {
              endpoint: 'https://api.openai.com/v1',
              api_key: 'sk-or-backup',
              upstream_model: 'gpt-5',
              format: 'openai',
            },
          ],
        },
      },
    };
    await writeConfig(filePath, config);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('sk-ant-primary');
    expect(content).toContain('sk-or-backup');
  });

  it('returns a Promise<void>', async () => {
    const result = writeConfig(filePath, MINIMAL_CONFIG);
    expect(result).toBeInstanceOf(Promise);
    await result; // should not throw
  });

  it('output is parseable YAML', async () => {
    await writeConfig(filePath, MINIMAL_CONFIG);
    const content = readFileSync(filePath, 'utf-8');
    // Re-parse using yaml to verify valid YAML
    const { parse } = await import('yaml');
    const parsed = parse(content);
    expect(parsed).toHaveProperty('server');
    expect(parsed).toHaveProperty('model_slots');
    expect(parsed.model_slots.opus.upstreams[0].api_key).toBe('sk-ant-test-key-here');
  });
});
