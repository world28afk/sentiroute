import Conf from 'conf';
import type { SentimentConfig } from '../config/schema.js';

// ── State schema ──

export interface SlotSentimentState {
  slotId: string;
  score: number;
  lastUpdated: number; // Date.now() timestamp
  currentUpstreamIndex: number;
  switchHistory: SwitchEvent[];
  cooldownUntil: number | null;
  triggerCount: number; // for exponential backoff
}

export interface SwitchEvent {
  fromIndex: number;
  toIndex: number;
  reason: string;
  score: number;
  timestamp: number;
}

interface StoreSchema {
  slots: Record<string, SlotSentimentState>;
}

// ── Defaults ──

export const DEFAULT_SENTIMENT_CONFIG: SentimentConfig = {
  threshold: 0.6,
  decayRate: 0.1,
  cooldownMs: 300000,
  antiFlapMs: 60000,
};

function defaultSlotState(slotId: string): SlotSentimentState {
  return {
    slotId,
    score: 0,
    lastUpdated: Date.now(),
    currentUpstreamIndex: 0,
    switchHistory: [],
    cooldownUntil: null,
    triggerCount: 0,
  };
}

// ── Write queue for concurrent-request safety ──

type QueuedOp<T> = () => Promise<T>;

function createWriteQueue() {
  let tail: Promise<unknown> = Promise.resolve();

  function enqueue<T>(op: QueuedOp<T>): Promise<T> {
    const result = tail.then(op, op); // on error, still run next
    tail = result.catch(() => {}); // keep the chain alive
    return result;
  }

  return { enqueue };
}

// ── State manager ──

export class SentimentState {
  private store: Conf<StoreSchema>;
  private queue = createWriteQueue();

  constructor(dataDir?: string) {
    this.store = new Conf<StoreSchema>({
      projectName: 'sentiroute',
      projectSuffix: '',
      schema: {
        slots: {
          type: 'object',
          default: {},
        },
      },
      ...(dataDir ? { cwd: dataDir } : {}),
    });
  }

  getSlot(slotId: string): SlotSentimentState {
    const slots = this.store.get('slots');
    return slots[slotId] ?? defaultSlotState(slotId);
  }

  getAllSlots(): Record<string, SlotSentimentState> {
    return this.store.get('slots');
  }

  async updateScore(
    slotId: string,
    newScore: number,
    sentimentConfig: SentimentConfig = DEFAULT_SENTIMENT_CONFIG,
  ): Promise<SlotSentimentState> {
    return this.queue.enqueue(async () => {
      const slots = this.store.get('slots');
      const current = slots[slotId] ?? defaultSlotState(slotId);

      // Apply time decay
      const hoursSince = (Date.now() - current.lastUpdated) / (1000 * 60 * 60);
      const decayedScore = current.score * Math.exp(-sentimentConfig.decayRate * hoursSince);

      // Blend: 70% new signal, 30% accumulated (smoothed)
      const blended = decayedScore * 0.3 + newScore * 0.7;

      const updated: SlotSentimentState = {
        ...current,
        score: Math.min(1.0, Math.max(0, blended)),
        lastUpdated: Date.now(),
      };

      this.store.set('slots', { ...slots, [slotId]: updated });
      return updated;
    });
  }

  async recordSwitch(
    slotId: string,
    fromIndex: number,
    toIndex: number,
    reason: string,
    score: number,
  ): Promise<SlotSentimentState> {
    return this.queue.enqueue(async () => {
      const slots = this.store.get('slots');
      const current = slots[slotId] ?? defaultSlotState(slotId);

      const event: SwitchEvent = {
        fromIndex,
        toIndex,
        reason,
        score,
        timestamp: Date.now(),
      };

      const updated: SlotSentimentState = {
        ...current,
        currentUpstreamIndex: toIndex,
        switchHistory: [...current.switchHistory, event].slice(-20),
        triggerCount: current.triggerCount + 1,
      };

      this.store.set('slots', { ...slots, [slotId]: updated });
      return updated;
    });
  }

  async resetSlot(slotId: string): Promise<void> {
    return this.queue.enqueue(async () => {
      const slots = this.store.get('slots');
      const fresh = defaultSlotState(slotId);
      this.store.set('slots', { ...slots, [slotId]: fresh });
    });
  }

  async setCooldown(slotId: string, durationMs: number): Promise<void> {
    return this.queue.enqueue(async () => {
      const slots = this.store.get('slots');
      const current = slots[slotId] ?? defaultSlotState(slotId);
      this.store.set('slots', {
        ...slots,
        [slotId]: { ...current, cooldownUntil: Date.now() + durationMs },
      });
    });
  }

  /** for graceful shutdown */
  flush(): void {
    // conf writes synchronously, but this is a no-op safety hook
  }
}
