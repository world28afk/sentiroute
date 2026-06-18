import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIAnalyzer } from '../ai-analyzer.js';

describe('AIAnalyzer.enabled', () => {
  it('disabled when config missing', () => {
    const a = new AIAnalyzer(undefined);
    expect(a.enabled).toBe(false);
  });
  it('disabled when enabled flag is false', () => {
    const a = new AIAnalyzer({ enabled: false } as any);
    expect(a.enabled).toBe(false);
  });
  it('disabled when no endpoint/key', () => {
    const a = new AIAnalyzer({ enabled: true } as any);
    expect(a.enabled).toBe(false);
  });
  it('enabled when all required fields present', () => {
    const a = new AIAnalyzer({
      enabled: true,
      endpoint: 'https://api.openai.com/v1',
      api_key: 'sk-test',
      model: 'gpt-4o-mini',
      format: 'openai',
      timeoutMs: 8000,
      triggerScore: 0.3,
      cacheTtlMs: 60000,
      weight: 0.6,
      maxTurns: 6,
    } as any);
    expect(a.enabled).toBe(true);
  });
});

describe('AIAnalyzer.shouldInvoke', () => {
  it('returns false when disabled', () => {
    const a = new AIAnalyzer(undefined);
    expect(a.shouldInvoke(0.9)).toBe(false);
  });

  it('respects triggerScore gate', () => {
    const a = new AIAnalyzer({
      enabled: true,
      endpoint: 'https://api.x.com/v1',
      api_key: 'k',
      triggerScore: 0.5,
    } as any);
    expect(a.shouldInvoke(0.49)).toBe(false);
    expect(a.shouldInvoke(0.5)).toBe(true);
    expect(a.shouldInvoke(0.8)).toBe(true);
  });
});

describe('AIAnalyzer.blend', () => {
  const a = new AIAnalyzer({
    enabled: true,
    endpoint: 'https://api.x.com/v1',
    api_key: 'k',
    weight: 0.5,
  } as any);

  it('passes through rule score when verdict is null', () => {
    expect(a.blend(0.3, null)).toBe(0.3);
  });

  it('blends rule and AI scores with configured weight', () => {
    const blended = a.blend(0.2, {
      frustrationScore: 0.8,
      degradationScore: 0.4,
      refusal: false,
      reason: 'test',
      fromCache: false,
    });
    // 0.2 * 0.5 + 0.8 * 0.5 = 0.1 + 0.4 = 0.5
    expect(blended).toBeCloseTo(0.5, 3);
  });

  it('takes max of frustration vs degradation', () => {
    const blended = a.blend(0, {
      frustrationScore: 0.2,
      degradationScore: 0.9,
      refusal: false,
      reason: '',
      fromCache: false,
    });
    expect(blended).toBeCloseTo(0.45, 2);
  });

  it('clamps to 1.0', () => {
    const high = new AIAnalyzer({ enabled: true, endpoint: 'x', api_key: 'k', weight: 1 } as any);
    expect(
      high.blend(0.9, { frustrationScore: 1.5, degradationScore: 1.5, refusal: false, reason: '', fromCache: false }),
    ).toBe(1);
  });
});

describe('AIAnalyzer.analyze — OpenAI format with mocked fetch', () => {
  const baseCfg = {
    enabled: true,
    endpoint: 'https://api.openai.com/v1',
    api_key: 'sk-test',
    model: 'gpt-4o-mini',
    format: 'openai' as const,
    timeoutMs: 8000,
    triggerScore: 0.3,
    cacheTtlMs: 60000,
    weight: 0.6,
    maxTurns: 6,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when disabled', async () => {
    const a = new AIAnalyzer(undefined);
    const v = await a.analyze([{ role: 'user', content: 'hi' }]);
    expect(v).toBeNull();
  });

  it('parses well-formed JSON verdict', async () => {
    const fakeFetch = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"frustrationScore":0.7,"degradationScore":0.3,"refusal":false,"reason":"user cursing"}',
            },
          },
        ],
      }),
    } as any);

    const a = new AIAnalyzer(baseCfg);
    const v = await a.analyze([{ role: 'user', content: 'this fucking model is dumb' }]);
    expect(v).not.toBeNull();
    expect(v!.frustrationScore).toBe(0.7);
    expect(v!.degradationScore).toBe(0.3);
    expect(v!.refusal).toBe(false);
    expect(v!.reason).toBe('user cursing');
    expect(v!.fromCache).toBe(false);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('extracts JSON from markdown-prefixed response', async () => {
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'Sure, here is the verdict:\n```json\n{"frustrationScore":0.4,"degradationScore":0.6,"refusal":true,"reason":"declined"}\n```',
            },
          },
        ],
      }),
    } as any);

    const a = new AIAnalyzer(baseCfg);
    const v = await a.analyze([{ role: 'user', content: 'help' }]);
    expect(v!.frustrationScore).toBe(0.4);
    expect(v!.degradationScore).toBe(0.6);
    expect(v!.refusal).toBe(true);
  });

  it('clamps out-of-range scores', async () => {
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"frustrationScore":1.7,"degradationScore":-0.3,"refusal":0,"reason":""}' } }],
      }),
    } as any);

    const a = new AIAnalyzer(baseCfg);
    const v = await a.analyze([{ role: 'user', content: 'hi' }]);
    expect(v!.frustrationScore).toBe(1);
    expect(v!.degradationScore).toBe(0);
  });

  it('returns null on non-OK HTTP', async () => {
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({ ok: false } as any);
    const a = new AIAnalyzer(baseCfg);
    const v = await a.analyze([{ role: 'user', content: 'hi' }]);
    expect(v).toBeNull();
  });

  it('returns null on malformed verdict text', async () => {
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'nothing-json-here' } }] }),
    } as any);
    const a = new AIAnalyzer(baseCfg);
    const v = await a.analyze([{ role: 'user', content: 'hi' }]);
    expect(v).toBeNull();
  });

  it('caches verdicts and serves second call from cache', async () => {
    const spy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"frustrationScore":0.5,"degradationScore":0.5,"refusal":false,"reason":"x"}' } }],
      }),
    } as any);

    const a = new AIAnalyzer(baseCfg);
    const v1 = await a.analyze([{ role: 'user', content: 'same' }]);
    const v2 = await a.analyze([{ role: 'user', content: 'same' }]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(v1!.fromCache).toBe(false);
    expect(v2!.fromCache).toBe(true);
  });

  it('returns null on network error', async () => {
    vi.spyOn(globalThis, 'fetch' as any).mockRejectedValue(new Error('econnrefused'));
    const a = new AIAnalyzer(baseCfg);
    const v = await a.analyze([{ role: 'user', content: 'hi' }]);
    expect(v).toBeNull();
  });
});

describe('AIAnalyzer.analyze — Anthropic format with mocked fetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses Anthropic Messages content blocks', async () => {
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          { type: 'text', text: '{"frustrationScore":0.6,"degradationScore":0.2,"refusal":false,"reason":"venting"}' },
        ],
      }),
    } as any);

    const a = new AIAnalyzer({
      enabled: true,
      endpoint: 'https://api.anthropic.com/v1',
      api_key: 'sk-ant-test',
      model: 'claude-haiku',
      format: 'anthropic',
      timeoutMs: 8000,
      triggerScore: 0.3,
      cacheTtlMs: 60000,
      weight: 0.6,
      maxTurns: 6,
    } as any);

    const v = await a.analyze([{ role: 'user', content: 'this sucks' }]);
    expect(v).not.toBeNull();
    expect(v!.frustrationScore).toBe(0.6);
    expect(v!.degradationScore).toBe(0.2);
  });
});
