import type { SentimentConfig } from '../config/schema.js';
import type { SentimentState, SlotSentimentState } from './state.js';

// ── Decision result ──

export interface SwitchDecision {
  upstreamIndex: number;
  switchEvent?: {
    fromIndex: number;
    toIndex: number;
    reason: string;
  };
  cooldownMs?: number; // new cooldown to set (for exponential backoff)
}

// ── Pure decision function ──

const MAX_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cap

export function evaluateSwitch(
  slotState: SlotSentimentState,
  config: SentimentConfig,
  totalUpstreams: number,
): SwitchDecision {
  const now = Date.now();

  // Cooldown active — stay on current upstream
  if (slotState.cooldownUntil && now < slotState.cooldownUntil) {
    return { upstreamIndex: slotState.currentUpstreamIndex };
  }

  // Anti-flap: prevent switching again too quickly
  const lastSwitch = slotState.switchHistory.at(-1);
  if (lastSwitch && (now - lastSwitch.timestamp) < config.antiFlapMs) {
    return { upstreamIndex: slotState.currentUpstreamIndex };
  }

  const onPrimary = slotState.currentUpstreamIndex === 0;
  const overThreshold = slotState.score > config.threshold;

  // Trigger: score exceeded threshold while on primary → switch to backup
  if (overThreshold && onPrimary && totalUpstreams > 1) {
    const nextIndex = 1; // Always go to first backup
    const backoffMs = Math.min(
      MAX_COOLDOWN_MS,
      config.cooldownMs * (2 ** slotState.triggerCount),
    );
    return {
      upstreamIndex: nextIndex,
      switchEvent: {
        fromIndex: 0,
        toIndex: nextIndex,
        reason: `sentiment threshold exceeded (score: ${slotState.score.toFixed(2)}, threshold: ${config.threshold})`,
      },
      cooldownMs: backoffMs,
    };
  }

  // Recovery: score dropped below threshold while on backup with cooldown expired → go back to primary
  if (!overThreshold && !onPrimary && totalUpstreams > 1) {
    return {
      upstreamIndex: 0,
      switchEvent: {
        fromIndex: slotState.currentUpstreamIndex,
        toIndex: 0,
        reason: `sentiment recovered (score: ${slotState.score.toFixed(2)}, threshold: ${config.threshold})`,
      },
    };
  }

  // Try next backup if already on backup and still frustrated
  if (overThreshold && !onPrimary && totalUpstreams > 2) {
    const nextIndex = (slotState.currentUpstreamIndex + 1) % totalUpstreams;
    // Don't cycle back to 0 — that's handled by recovery
    if (nextIndex === 0) {
      return { upstreamIndex: slotState.currentUpstreamIndex };
    }
    const backoffMs = Math.min(
      MAX_COOLDOWN_MS,
      config.cooldownMs * (2 ** slotState.triggerCount),
    );
    return {
      upstreamIndex: nextIndex,
      switchEvent: {
        fromIndex: slotState.currentUpstreamIndex,
        toIndex: nextIndex,
        reason: `escalating to next backup (score: ${slotState.score.toFixed(2)})`,
      },
      cooldownMs: backoffMs,
    };
  }

  // Stay on current upstream
  return { upstreamIndex: slotState.currentUpstreamIndex };
}

// ── Stateful wrapper for route handlers ──

export async function applySentimentSwitch(
  state: SentimentState,
  slotId: string,
  config: SentimentConfig,
  totalUpstreams: number,
): Promise<{ upstreamIndex: number; switched: boolean; reason?: string }> {
  const slotState = state.getSlot(slotId);
  const decision = evaluateSwitch(slotState, config, totalUpstreams);

  if (!decision.switchEvent) {
    return { upstreamIndex: decision.upstreamIndex, switched: false };
  }

  // Record the switch
  await state.recordSwitch(
    slotId,
    decision.switchEvent.fromIndex,
    decision.switchEvent.toIndex,
    decision.switchEvent.reason,
    slotState.score,
  );

  // Set cooldown if needed
  if (decision.cooldownMs) {
    await state.setCooldown(slotId, decision.cooldownMs);
  }

  return {
    upstreamIndex: decision.upstreamIndex,
    switched: true,
    reason: decision.switchEvent.reason,
  };
}
