import { describe, it, expect } from 'vitest';
import { maskApiKeys } from '../mask.js';

describe('maskApiKeys', () => {
  it('masks a top-level api_key with first 2 + last 6 for long keys', () => {
    const result = maskApiKeys({ api_key: 'sk-ant-api03-abcdefghijklmnop' });
    expect(result.api_key).toBe('sk...klmnop');
  });

  it('masks api_key inside nested upstreams array', () => {
    const input = {
      upstreams: [
        { name: 'Primary', api_key: 'sk-abc123456789' },
        { name: 'Backup', api_key: 'sk-xyz987654321' },
      ],
    };
    const result = maskApiKeys(input);
    expect(result.upstreams[0].api_key).toBe('sk...456789');
    expect(result.upstreams[1].api_key).toBe('sk...654321');
  });

  it('leaves objects without api_key unchanged', () => {
    const input = { name: 'test', endpoint: 'https://api.example.com' };
    const result = maskApiKeys(input);
    expect(result).toEqual({ name: 'test', endpoint: 'https://api.example.com' });
  });

  it('masks short keys (length <= 8) as ***', () => {
    const result = maskApiKeys({ api_key: 'abcd' });
    expect(result.api_key).toBe('***');
  });

  it('masks exactly 8-char keys as ***', () => {
    const result = maskApiKeys({ api_key: '12345678' });
    expect(result.api_key).toBe('***');
  });

  it('masks 9-char keys with first 2 + last 6', () => {
    // 9 chars: "123456789" -> "12...456789" is impossible since slice(-6) needs 6 chars
    // 9 chars: first 2 = "12", last 6 = "456789", middle char "3" is dropped
    const result = maskApiKeys({ api_key: '123456789' });
    expect(result.api_key).toBe('12...456789');
  });

  it('does not mutate the original input object', () => {
    const input = { api_key: 'sk-ant-test-key-value-here' };
    const original = structuredClone(input);
    maskApiKeys(input);
    expect(input).toEqual(original);
  });

  it('handles nested objects at arbitrary depth', () => {
    const input = {
      server: { host: '127.0.0.1' },
      model_slots: {
        opus: {
          model: 'claude-opus-4-7',
          upstreams: [
            { api_key: 'sk-deeply-nested-key-value', endpoint: 'https://api.anthropic.com/v1' },
          ],
        },
      },
    };
    const result = maskApiKeys(input);
    expect(result.model_slots.opus.upstreams[0].api_key).toBe('sk...-value');
  });

  it('returns the same type structure as the input', () => {
    const input = { api_key: 'sk-test', count: 42, active: true };
    const result = maskApiKeys(input);
    expect(typeof result.count).toBe('number');
    expect(typeof result.active).toBe('boolean');
  });

  it('handles arrays of primitives without error', () => {
    const input = { items: [1, 2, 3], names: ['a', 'b'] };
    const result = maskApiKeys(input);
    expect(result).toEqual({ items: [1, 2, 3], names: ['a', 'b'] });
  });

  it('handles null values', () => {
    const input = { api_key: null, name: 'test' };
    const result = maskApiKeys(input);
    expect(result.api_key).toBeNull();
    expect(result.name).toBe('test');
  });
});
