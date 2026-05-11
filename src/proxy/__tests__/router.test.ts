import { describe, it, expect } from 'vitest';
import { resolveSlot } from '../router.js';
import type { Config } from '../../config/schema.js';

const baseConfig: Config = {
  server: { port: 3000, host: '127.0.0.1' },
  model_slots: {
    'claude-opus-4-7': {
      model: 'claude-opus-4-7',
      upstreams: [{
        endpoint: 'https://api.anthropic.com/v1',
        api_key: 'sk-ant-test123',
        upstream_model: 'claude-opus-4-7',
        format: 'anthropic',
        timeoutMs: 120000,
      }],
    },
    'claude-sonnet-4-6': {
      model: 'claude-sonnet-4-6',
      upstreams: [
        {
          name: 'Primary',
          endpoint: 'https://api.anthropic.com/v1',
          api_key: 'sk-ant-test456',
          upstream_model: 'claude-sonnet-4-6',
          format: 'anthropic',
          timeoutMs: 60000,
        },
        {
          name: 'Backup',
          endpoint: 'https://api.openai.com/v1',
          api_key: 'sk-or-test789',
          upstream_model: 'gpt-5',
          format: 'openai',
          timeoutMs: 120000,
        },
      ],
    },
  },
};

describe('resolveSlot', () => {
  it('resolves primary upstream (index 0) by default', () => {
    const slot = resolveSlot(baseConfig, 'claude-opus-4-7');
    expect(slot.slotId).toBe('claude-opus-4-7');
    expect(slot.endpoint).toBe('https://api.anthropic.com/v1');
    expect(slot.apiKey).toBe('sk-ant-test123');
    expect(slot.format).toBe('anthropic');
    expect(slot.upstreamName).toBe('upstream-0');
    expect(slot.upstreamIndex).toBe(0);
    expect(slot.totalUpstreams).toBe(1);
  });

  it('uses default timeoutMs when not configured', () => {
    const slot = resolveSlot(baseConfig, 'claude-opus-4-7');
    expect(slot.timeoutMs).toBe(120000);
  });

  it('falls back to 120000 when upstream timeoutMs is undefined', () => {
    const partialConfig: Config = {
      ...baseConfig,
      model_slots: {
        'claude-opus-4-7': {
          model: 'claude-opus-4-7',
          upstreams: [{
            endpoint: 'https://api.anthropic.com/v1',
            api_key: 'sk-ant-test123',
            upstream_model: 'claude-opus-4-7',
            format: 'anthropic',
            timeoutMs: undefined as unknown as number,
          }],
        },
      },
    };
    const slot = resolveSlot(partialConfig, 'claude-opus-4-7');
    expect(slot.timeoutMs).toBe(120000);
  });

  it('uses configured timeoutMs when present', () => {
    const slot = resolveSlot(baseConfig, 'claude-sonnet-4-6');
    expect(slot.timeoutMs).toBe(60000);
  });

  it('resolves upstream by index (backup at index 1)', () => {
    const slot = resolveSlot(baseConfig, 'claude-sonnet-4-6', 1);
    expect(slot.upstreamIndex).toBe(1);
    expect(slot.totalUpstreams).toBe(2);
    expect(slot.upstreamName).toBe('Backup');
    expect(slot.endpoint).toBe('https://api.openai.com/v1');
    expect(slot.format).toBe('openai');
    expect(slot.upstreamModel).toBe('gpt-5');
  });

  it('falls back to index 0 when requested index is out of bounds', () => {
    const slot = resolveSlot(baseConfig, 'claude-opus-4-7', 5);
    expect(slot.upstreamIndex).toBe(0);
    expect(slot.apiKey).toBe('sk-ant-test123');
  });

  it('fuzzy matches model name containing slot key', () => {
    const slot = resolveSlot(baseConfig, 'claude-sonnet-4-6-some-variant');
    expect(slot.slotId).toBe('claude-sonnet-4-6');
    expect(slot.format).toBe('anthropic');
  });

  it('throws for unknown model ID with available slots hint', () => {
    expect(() => resolveSlot(baseConfig, 'unknown-model')).toThrow(
      'No matching model slot',
    );
  });
});
