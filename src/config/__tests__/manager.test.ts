import { describe, it, expect, beforeEach } from 'vitest';
import type { Config } from '../schema.js';

// We import the actual module — tests will guide implementation
import { ConfigManager } from '../manager.js';

// ── Helpers ──

function makeMinimalConfig(overrides?: Partial<Config>): Config {
  return {
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
            timeoutMs: 120000,
          },
        ],
      },
    },
    sentiment: {
      threshold: 0.6,
      decayRate: 0.1,
      cooldownMs: 300000,
      antiFlapMs: 60000,
      weights: {
        profanity: 0.8,
        degradation: 0.9,
        imperatives: 0.4,
        caps: 0.3,
        brevity: 0.2,
        repetition: 0.6,
      },
    },
    ...overrides,
  };
}

// ── Tests ──

describe('ConfigManager', () => {
  let manager: ConfigManager;
  let initial: Config;

  beforeEach(() => {
    initial = makeMinimalConfig();
    manager = new ConfigManager(initial, '/fake/path/sentiroute.yaml');
  });

  // ── Test 1: Constructor stores initial config ──
  it('stores initial config; .config returns the current config object', () => {
    expect(manager.config).toBe(initial);
    expect(manager.config.server.port).toBe(3000);
    expect(manager.config.model_slots.opus.model).toBe('claude-opus-4-7');
  });

  // ── Test 2: updateSentiment modifies in-memory, no disk write ──
  it('updateSentiment({ threshold: 0.8 }) changes threshold in-memory', () => {
    manager.updateSentiment({ threshold: 0.8 });
    expect(manager.config.sentiment?.threshold).toBe(0.8);
    // Other fields remain unchanged
    expect(manager.config.sentiment?.decayRate).toBe(0.1);
  });

  // ── Test 3: updateSentiment merges multiple fields ──
  it('updateSentiment merges multiple params, leaves others unchanged', () => {
    manager.updateSentiment({ decayRate: 0.2, cooldownMs: 600000 });
    const s = manager.config.sentiment!;
    expect(s.decayRate).toBe(0.2);
    expect(s.cooldownMs).toBe(600000);
    expect(s.threshold).toBe(0.6);   // unchanged
    expect(s.antiFlapMs).toBe(60000); // unchanged
  });

  // ── Test 4: updateWeights modifies single weight ──
  it('updateWeights({ profanity: 0.5 }) changes profanity, other weights unchanged', () => {
    manager.updateWeights({ profanity: 0.5 });
    const w = manager.config.sentiment!.weights!;
    expect(w.profanity).toBe(0.5);
    expect(w.degradation).toBe(0.9);  // unchanged
    expect(w.imperatives).toBe(0.4);  // unchanged
    expect(w.caps).toBe(0.3);         // unchanged
    expect(w.brevity).toBe(0.2);      // unchanged
    expect(w.repetition).toBe(0.6);   // unchanged
  });

  // ── Test 5: persistToDisk delegates to writeConfig ──
  it('persistToDisk returns a Promise (delegates to writeConfig)', async () => {
    // The Promise resolves or rejects depending on filesystem — we just verify the shape
    const result = manager.persistToDisk();
    expect(result).toBeInstanceOf(Promise);
    // The /fake/path doesn't exist, so it will reject with ENOENT — catch to avoid unhandled rejection
    await result.catch(() => { /* expected filesystem error */ });
  });

  // ── Test 6: getSanitizedConfig masks api_key fields, does not mutate original ──
  it('getSanitizedConfig masks api_key values, original is not mutated', () => {
    const sanitized = manager.getSanitizedConfig() as Config;
    // Check that the nested api_key is masked
    const upstream1 = (sanitized as any).model_slots?.opus?.upstreams?.[0];
    expect(upstream1.api_key).toBe('sk...y-here');

    // Original must still have the unmasked key
    expect(manager.config.model_slots.opus.upstreams[0].api_key).toBe('sk-ant-test-key-here');
  });

  // ── Test 7: updateSentiment creates sentiment with defaults when missing ──
  it('updateSentiment initializes sentiment with defaults when absent', () => {
    const noSentiment = makeMinimalConfig({ sentiment: undefined });
    const mgr = new ConfigManager(noSentiment, '/fake/path.yaml');
    expect(mgr.config.sentiment).toBeUndefined();

    mgr.updateSentiment({ threshold: 0.8 });
    expect(mgr.config.sentiment).toBeDefined();
    expect(mgr.config.sentiment!.threshold).toBe(0.8);
    expect(mgr.config.sentiment!.decayRate).toBe(0.1); // default
    expect(mgr.config.sentiment!.cooldownMs).toBe(300000); // default
    expect(mgr.config.sentiment!.antiFlapMs).toBe(60000); // default
  });

  // ── Test 8: updateWeights creates weights with provided values when missing ──
  it('updateWeights initializes weights with provided values when weights absent', () => {
    const noWeights = makeMinimalConfig({
      sentiment: {
        threshold: 0.6,
        decayRate: 0.1,
        cooldownMs: 300000,
        antiFlapMs: 60000,
        // no weights
      },
    });
    const mgr = new ConfigManager(noWeights, '/fake/path.yaml');
    expect(mgr.config.sentiment!.weights).toBeUndefined();

    mgr.updateWeights({ profanity: 0.5 });
    expect(mgr.config.sentiment!.weights).toBeDefined();
    expect(mgr.config.sentiment!.weights!.profanity).toBe(0.5);
  });

  // ── Additional: config is a public mutable property (not getter) ──
  it('config is a public mutable property — can be replaced entirely', () => {
    const newConfig = makeMinimalConfig({
      server: { port: 9999, host: '0.0.0.0' },
    });
    manager.config = newConfig;
    expect(manager.config.server.port).toBe(9999);
  });
});
