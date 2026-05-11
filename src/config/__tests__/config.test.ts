import { describe, it, expect } from 'vitest';
import { configSchema } from '../schema.js';
import { ConfigValidationError } from '../errors.js';

describe('configSchema', () => {
  it('rejects empty model_slots with "At least one model slot is required"', () => {
    const result = configSchema.safeParse({ model_slots: {} });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i: { message: string }) => i.message);
      expect(messages).toContain('At least one model slot is required');
    }
  });

  it('rejects upstream endpoint that is not a valid URL', () => {
    const result = configSchema.safeParse({
      model_slots: {
        'test-slot': {
          model: 'test-model',
          upstreams: [{
            endpoint: 'not-a-url',
            api_key: 'sk-test',
            upstream_model: 'test-model',
            format: 'anthropic',
          }],
        },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i: { message: string }) => i.message);
      expect(messages.some((m: string) => m.toLowerCase().includes('url') || m.includes('Invalid'))).toBe(true);
    }
  });

  it('rejects api_key shorter than 1 character', () => {
    const result = configSchema.safeParse({
      model_slots: {
        'test-slot': {
          model: 'test-model',
          upstreams: [{
            endpoint: 'https://api.anthropic.com/v1',
            api_key: '',
            upstream_model: 'test-model',
            format: 'anthropic',
          }],
        },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i: { message: string }) => i.message);
      expect(messages.some((m: string) => m.toLowerCase().includes('api key') || m.includes('required'))).toBe(true);
    }
  });

  it('rejects empty upstreams array', () => {
    const result = configSchema.safeParse({
      model_slots: {
        'test-slot': {
          model: 'test-model',
          upstreams: [],
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid minimal config with defaults applied', () => {
    const result = configSchema.safeParse({
      server: {},
      model_slots: {
        'claude-opus-4-7': {
          model: 'claude-opus-4-7',
          upstreams: [{
            endpoint: 'https://api.anthropic.com/v1',
            api_key: 'sk-ant-test123',
            upstream_model: 'claude-opus-4-7',
            format: 'anthropic',
          }],
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.server.port).toBe(3000);
      expect(result.data.server.host).toBe('127.0.0.1');
    }
  });

  it('accepts multiple upstreams per slot', () => {
    const result = configSchema.safeParse({
      server: {},
      model_slots: {
        'test-slot': {
          model: 'test-model',
          upstreams: [
            {
              endpoint: 'https://api.anthropic.com/v1',
              api_key: 'sk-ant-1',
              upstream_model: 'claude-opus-4-7',
              format: 'anthropic' as const,
            },
            {
              endpoint: 'https://api.openai.com/v1',
              api_key: 'sk-or-2',
              upstream_model: 'gpt-5',
              format: 'openai' as const,
            },
            {
              endpoint: 'https://backup.example.com/v1',
              api_key: 'sk-bk-3',
              upstream_model: 'backup-model',
              format: 'anthropic' as const,
            },
          ],
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model_slots['test-slot'].upstreams).toHaveLength(3);
    }
  });
});

describe('upstreamConfigSchema timeoutMs', () => {
  it('defaults timeoutMs to 120000 when not provided', () => {
    const result = configSchema.safeParse({
      server: {},
      model_slots: {
        'test-slot': {
          model: 'test-model',
          upstreams: [{
            endpoint: 'https://api.anthropic.com/v1',
            api_key: 'sk-test',
            upstream_model: 'test-model',
            format: 'anthropic',
          }],
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const slot = result.data.model_slots['test-slot'];
      expect(slot.upstreams[0].timeoutMs).toBe(120000);
    }
  });

  it('accepts explicit timeoutMs: 60000', () => {
    const result = configSchema.safeParse({
      server: {},
      model_slots: {
        'test-slot': {
          model: 'test-model',
          upstreams: [{
            endpoint: 'https://api.anthropic.com/v1',
            api_key: 'sk-test',
            upstream_model: 'test-model',
            format: 'anthropic',
            timeoutMs: 60000,
          }],
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const slot = result.data.model_slots['test-slot'];
      expect(slot.upstreams[0].timeoutMs).toBe(60000);
    }
  });

  it('coerces string timeoutMs to number', () => {
    const result = configSchema.safeParse({
      server: {},
      model_slots: {
        'test-slot': {
          model: 'test-model',
          upstreams: [{
            endpoint: 'https://api.anthropic.com/v1',
            api_key: 'sk-test',
            upstream_model: 'test-model',
            format: 'anthropic',
            timeoutMs: '45000',
          }],
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const slot = result.data.model_slots['test-slot'];
      expect(slot.upstreams[0].timeoutMs).toBe(45000);
    }
  });

  it('rejects negative timeoutMs', () => {
    const result = configSchema.safeParse({
      server: {},
      model_slots: {
        'test-slot': {
          model: 'test-model',
          upstreams: [{
            endpoint: 'https://api.anthropic.com/v1',
            api_key: 'sk-test',
            upstream_model: 'test-model',
            format: 'anthropic',
            timeoutMs: -1,
          }],
        },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('ConfigValidationError', () => {
  it('format() returns multi-line string with all issues listed', () => {
    const err = new ConfigValidationError('Invalid config', [
      {
        message: 'port must be number',
        filePath: 'test.yaml',
        line: 3,
        column: 5,
        expected: 'number',
        received: 'string',
      },
      {
        message: 'host is required',
        filePath: 'test.yaml',
        line: 2,
      },
    ]);

    const formatted = err.format();
    expect(formatted).toContain('Invalid config');
    expect(formatted).toContain('test.yaml:3:5');
    expect(formatted).toContain('expected: number');
    expect(formatted).toContain('received: string');
    expect(formatted).toContain('test.yaml:2');
  });
});
