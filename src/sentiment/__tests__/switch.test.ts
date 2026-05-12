import { describe, it, expect } from 'vitest';
import { evaluateSwitch } from '../switch.js';
import type { SlotSentimentState } from '../state.js';
import type { SentimentConfig } from '../../config/schema.js';

const DEFAULT_AI_METRICS = {
  avgResponseLength: 0,
  responseCount: 0,
  recentRefusal: 0,
  recentHedging: 0,
  recentApology: 0,
};

function makeState(overrides: Partial<SlotSentimentState> = {}): SlotSentimentState {
  return {
    slotId: 'test-slot',
    score: 0,
    lastUpdated: Date.now(),
    currentUpstreamIndex: 0,
    switchHistory: [],
    cooldownUntil: null,
    triggerCount: 0,
    aiMetrics: DEFAULT_AI_METRICS,
    ...overrides,
  };
}

const defaultConfig: SentimentConfig = {
  threshold: 0.6,
  decayRate: 0.1,
  cooldownMs: 300000,
  antiFlapMs: 60000,
};

describe('evaluateSwitch', () => {
  it('stays on primary when score is low', () => {
    const result = evaluateSwitch(makeState({ score: 0.2 }), defaultConfig, 2);
    expect(result.upstreamIndex).toBe(0);
    expect(result.switchEvent).toBeUndefined();
  });

  it('triggers switch when score exceeds threshold on primary', () => {
    const result = evaluateSwitch(makeState({ score: 0.75 }), defaultConfig, 2);
    expect(result.upstreamIndex).toBe(1);
    expect(result.switchEvent).toBeDefined();
    expect(result.switchEvent!.fromIndex).toBe(0);
    expect(result.switchEvent!.toIndex).toBe(1);
    expect(result.switchEvent!.reason).toContain('threshold exceeded');
  });

  it('no switch when only 1 upstream available', () => {
    const result = evaluateSwitch(makeState({ score: 0.9 }), defaultConfig, 1);
    expect(result.upstreamIndex).toBe(0);
    expect(result.switchEvent).toBeUndefined();
  });

  it('applies exponential backoff cooldown', () => {
    const result = evaluateSwitch(
      makeState({ score: 0.8, triggerCount: 2 }),
      defaultConfig,
      2,
    );
    expect(result.cooldownMs).toBe(300000 * 4); // base * 2^2
  });

  it('caps cooldown at 1 hour', () => {
    const result = evaluateSwitch(
      makeState({ score: 0.8, triggerCount: 10 }),
      defaultConfig,
      2,
    );
    expect(result.cooldownMs).toBe(60 * 60 * 1000);
  });

  it('stays on current upstream during cooldown', () => {
    const result = evaluateSwitch(
      makeState({
        score: 0.8,
        currentUpstreamIndex: 1,
        cooldownUntil: Date.now() + 60000,
      }),
      defaultConfig,
      2,
    );
    expect(result.upstreamIndex).toBe(1);
    expect(result.switchEvent).toBeUndefined();
  });

  it('recovers to primary when score drops below threshold', () => {
    const result = evaluateSwitch(
      makeState({
        score: 0.3,
        currentUpstreamIndex: 1,
        cooldownUntil: null, // cooldown expired
      }),
      defaultConfig,
      2,
    );
    expect(result.upstreamIndex).toBe(0);
    expect(result.switchEvent).toBeDefined();
    expect(result.switchEvent!.reason).toContain('recovered');
  });

  it('does not recover while score is still above threshold', () => {
    const result = evaluateSwitch(
      makeState({
        score: 0.8,
        currentUpstreamIndex: 1,
      }),
      defaultConfig,
      2,
    );
    // Should not recover (still over threshold) and should not escalate (only 2 upstreams)
    expect(result.switchEvent).toBeUndefined();
    expect(result.upstreamIndex).toBe(1);
  });

  it('escalates to next backup when already on backup and still frustrated', () => {
    const result = evaluateSwitch(
      makeState({
        score: 0.85,
        currentUpstreamIndex: 1,
        cooldownUntil: null,
      }),
      defaultConfig,
      3, // 3 upstreams
    );
    expect(result.upstreamIndex).toBe(2);
    expect(result.switchEvent).toBeDefined();
    expect(result.switchEvent!.reason).toContain('escalating');
  });

  it('does not cycle back to primary via escalation', () => {
    // On last backup (index 2 of 3), should not go to 0 via escalation
    const result = evaluateSwitch(
      makeState({
        score: 0.85,
        currentUpstreamIndex: 2,
        cooldownUntil: null,
      }),
      defaultConfig,
      3,
    );
    expect(result.upstreamIndex).toBe(2); // stays put, recovery handles going back
  });

  it('anti-flap prevents switching within antiFlapMs of last switch', () => {
    const result = evaluateSwitch(
      makeState({
        score: 0.9,
        currentUpstreamIndex: 0,
        switchHistory: [
          {
            fromIndex: 1,
            toIndex: 0,
            reason: 'recovered',
            score: 0.5,
            timestamp: Date.now() - 30000, // 30s ago < antiFlapMs (60s)
          },
        ],
      }),
      defaultConfig,
      2,
    );
    expect(result.switchEvent).toBeUndefined(); // anti-flap blocked
    expect(result.upstreamIndex).toBe(0);
  });

  it('allows switch after anti-flap window expires', () => {
    const result = evaluateSwitch(
      makeState({
        score: 0.9,
        currentUpstreamIndex: 0,
        switchHistory: [
          {
            fromIndex: 1,
            toIndex: 0,
            reason: 'recovered',
            score: 0.5,
            timestamp: Date.now() - 90000, // 90s ago > antiFlapMs (60s)
          },
        ],
      }),
      defaultConfig,
      2,
    );
    expect(result.switchEvent).toBeDefined();
  });

  it('respects custom config values', () => {
    const customConfig: SentimentConfig = {
      threshold: 0.4,
      decayRate: 0.2,
      cooldownMs: 60000,
      antiFlapMs: 30000,
    };
    const result = evaluateSwitch(makeState({ score: 0.5 }), customConfig, 2);
    expect(result.upstreamIndex).toBe(1); // 0.5 > 0.4 threshold
    expect(result.cooldownMs).toBe(60000); // no backoff on first trigger
  });
});
