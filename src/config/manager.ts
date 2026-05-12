/**
 * ConfigManager — shared mutable config reference for all route handlers.
 *
 * Wraps the Config object so that proxy routes, dashboard routes, and the main
 * app all see the same in-memory state.  Hot-updates to sentiment parameters
 * take effect immediately.  Structural changes are persisted to disk on demand.
 */

import type { Config, SentimentConfig, SentimentSignalWeights } from './schema.js';
import { writeConfig } from './writer.js';
import { maskApiKeys } from './mask.js';

const DEFAULT_SENTIMENT_CONFIG: SentimentConfig = {
  threshold: 0.6,
  decayRate: 0.1,
  cooldownMs: 300000,
  antiFlapMs: 60000,
};

export class ConfigManager {
  /**
   * Public mutable config property.
   *
   * All consumers (proxy routes, dashboard) read `configManager.config`
   * per-request and immediately see any in-memory mutations.
   */
  public config: Config;
  private configPath: string;

  constructor(initial: Config, configPath: string) {
    this.config = initial;
    this.configPath = configPath;
  }

  /**
   * Hot-update sentiment parameters.
   *
   * Changes take effect in-memory immediately — no file write.
   * If `config.sentiment` does not exist it is created with defaults first.
   */
  updateSentiment(params: Partial<SentimentConfig>): void {
    if (!this.config.sentiment) {
      this.config.sentiment = { ...DEFAULT_SENTIMENT_CONFIG };
    }
    this.config.sentiment = {
      ...this.config.sentiment,
      ...params,
    } as SentimentConfig;
  }

  /**
   * Hot-update signal weights.
   *
   * Changes take effect in-memory immediately — no file write.
   * If `config.sentiment` or `config.sentiment.weights` does not exist
   * they are initialised first.
   */
  updateWeights(weights: Record<string, number>): void {
    if (!this.config.sentiment) {
      this.config.sentiment = { ...DEFAULT_SENTIMENT_CONFIG };
    }
    if (!this.config.sentiment.weights) {
      this.config.sentiment.weights = {} as SentimentSignalWeights;
    }
    this.config.sentiment.weights = {
      ...this.config.sentiment.weights,
      ...weights,
    } as SentimentSignalWeights;
  }

  /**
   * Write the current config to the YAML file on disk.
   *
   * Returns the Promise from writeConfig — callers may await it or
   * fire-and-forget (e.g. after a REST API response).
   */
  async persistToDisk(): Promise<void> {
    return writeConfig(this.configPath, this.config);
  }

  /**
   * Return a deep-clone of the config with all API keys masked.
   *
   * Safe for API responses — never exposes raw credentials.
   * The original `this.config` is NOT mutated.
   */
  getSanitizedConfig(): Record<string, unknown> {
    const clone = structuredClone(this.config);
    return maskApiKeys(clone) as Record<string, unknown>;
  }
}
