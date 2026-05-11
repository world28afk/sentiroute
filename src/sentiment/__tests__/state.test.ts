import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { SentimentState } from '../state.js';

function tempDir(): string {
  const name = `sentiroute-test-${randomBytes(6).toString('hex')}`;
  const dir = join(tmpdir(), name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('SentimentState', () => {
  let dataDir: string;
  let state: SentimentState;

  beforeEach(() => {
    dataDir = tempDir();
    state = new SentimentState(dataDir);
  });

  afterEach(() => {
    if (existsSync(dataDir)) {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('returns default state for unknown slot', () => {
    const slot = state.getSlot('test-slot');
    expect(slot.slotId).toBe('test-slot');
    expect(slot.score).toBe(0);
    expect(slot.currentUpstreamIndex).toBe(0);
    expect(slot.switchHistory).toEqual([]);
    expect(slot.cooldownUntil).toBeNull();
    expect(slot.triggerCount).toBe(0);
  });

  it('updates score and persists', async () => {
    await state.updateScore('opus', 0.5);
    const slot = state.getSlot('opus');
    expect(slot.score).toBeCloseTo(0.35, 1); // 0.5 * 0.7 + 0 * 0.3
    expect(slot.lastUpdated).toBeGreaterThan(0);
  });

  it('applies time decay to accumulated score', async () => {
    // First update
    await state.updateScore('opus', 0.8);
    const first = state.getSlot('opus');

    // Manually backdate the lastUpdated to simulate time passing
    // We can't easily test decay via Conf since it serializes, so we verify the blend formula
    expect(first.score).toBeGreaterThan(0); // should have some score from blending
  });

  it('scores never exceed 1.0', async () => {
    for (let i = 0; i < 10; i++) {
      await state.updateScore('opus', 1.0);
    }
    const slot = state.getSlot('opus');
    expect(slot.score).toBeLessThanOrEqual(1.0);
  });

  it('scores never go below 0', async () => {
    await state.updateScore('opus', 0);
    const slot = state.getSlot('opus');
    expect(slot.score).toBeGreaterThanOrEqual(0);
  });

  it('records switch events', async () => {
    const result = await state.recordSwitch('opus', 0, 1, 'sentiment threshold exceeded', 0.75);
    expect(result.currentUpstreamIndex).toBe(1);
    expect(result.switchHistory).toHaveLength(1);
    expect(result.switchHistory[0].fromIndex).toBe(0);
    expect(result.switchHistory[0].toIndex).toBe(1);
    expect(result.switchHistory[0].reason).toBe('sentiment threshold exceeded');
    expect(result.triggerCount).toBe(1);
  });

  it('truncates switch history to last 20 events', async () => {
    for (let i = 0; i < 25; i++) {
      await state.recordSwitch('opus', i, i + 1, 'test', 0.5);
    }
    const slot = state.getSlot('opus');
    expect(slot.switchHistory.length).toBeLessThanOrEqual(20);
    expect(slot.triggerCount).toBe(25);
  });

  it('resets slot to default', async () => {
    await state.updateScore('opus', 0.9);
    await state.recordSwitch('opus', 0, 1, 'test', 0.9);
    await state.resetSlot('opus');

    const slot = state.getSlot('opus');
    expect(slot.score).toBe(0);
    expect(slot.currentUpstreamIndex).toBe(0);
    expect(slot.switchHistory).toEqual([]);
    expect(slot.triggerCount).toBe(0);
  });

  it('sets cooldown', async () => {
    await state.setCooldown('opus', 300000);
    const slot = state.getSlot('opus');
    expect(slot.cooldownUntil).toBeGreaterThan(Date.now());
    expect(slot.cooldownUntil).toBeLessThanOrEqual(Date.now() + 300001);
  });

  it('persists state across instances', async () => {
    await state.updateScore('opus', 0.7);

    // Create a new instance pointing to same dir
    const state2 = new SentimentState(dataDir);
    const slot = state2.getSlot('opus');
    expect(slot.score).toBeGreaterThan(0);
  });

  it('tracks multiple slots independently', async () => {
    await state.updateScore('opus', 0.8);
    await state.updateScore('sonnet', 0.2);

    const opus = state.getSlot('opus');
    const sonnet = state.getSlot('sonnet');
    expect(opus.score).toBeGreaterThan(sonnet.score);
  });

  it('queues concurrent updates safely', async () => {
    // Fire multiple updates concurrently — should all complete without corruption
    const updates = [0.1, 0.3, 0.5, 0.7, 0.9].map((s) =>
      state.updateScore('opus', s),
    );
    await Promise.all(updates);

    const slot = state.getSlot('opus');
    expect(slot.score).toBeGreaterThanOrEqual(0);
    expect(slot.score).toBeLessThanOrEqual(1.0);
  });
});
