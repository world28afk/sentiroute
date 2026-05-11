import type { Config, UpstreamConfig } from '../config/schema.js';

export interface ResolvedSlot {
  slotId: string;
  endpoint: string;
  apiKey: string;
  upstreamModel: string;
  upstreamName: string;
  format: 'anthropic' | 'openai';
  timeoutMs: number;
  upstreamIndex: number;
  totalUpstreams: number;
}

export function resolveSlot(
  config: Config,
  modelId: string,
  upstreamIndex = 0,
): ResolvedSlot {
  const lowerModel = modelId.toLowerCase();
  const slotKey = Object.keys(config.model_slots).find((key) =>
    lowerModel.includes(key.toLowerCase()),
  );
  const slotConfig = slotKey ? config.model_slots[slotKey] : config.model_slots[modelId];
  if (!slotConfig) {
    const available = Object.keys(config.model_slots).join(', ');
    throw new Error(`No matching model slot for "${modelId}". Available slots: ${available}`);
  }

  const upstreams = slotConfig.upstreams;
  const index = upstreamIndex < upstreams.length ? upstreamIndex : 0;
  const upstream: UpstreamConfig = upstreams[index];

  return {
    slotId: slotKey ?? modelId,
    endpoint: upstream.endpoint,
    apiKey: upstream.api_key,
    upstreamModel: upstream.upstream_model,
    upstreamName: upstream.name || `upstream-${index}`,
    format: upstream.format,
    timeoutMs: upstream.timeoutMs ?? 120000,
    upstreamIndex: index,
    totalUpstreams: upstreams.length,
  };
}
