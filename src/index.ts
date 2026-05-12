import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig } from './config/loader.js';
import { ConfigManager } from './config/manager.js';
import { createApp } from './server/app.js';
import { resolveConfigPath } from './config/paths.js';
import { VERSION } from './utils/version.js';
import { SentimentState } from './sentiment/state.js';
import { writeConfig } from './config/writer.js';
import { configSchema } from './config/schema.js';
import type { Config, SentimentConfig } from './config/schema.js';

function createDefaultConfig(): Config {
  const result = configSchema.safeParse({
    server: { port: 3000, host: '127.0.0.1' },
    sentiment: {
      threshold: 0.6,
      decayRate: 0.1,
      cooldownMs: 300000,
      antiFlapMs: 60000,
      weights: {
        profanity: 0.8, degradation: 0.9, imperatives: 0.4,
        caps: 0.3, brevity: 0.2, repetition: 0.6,
      },
    },
    model_slots: {
      'claude-opus-4.7': {
        model: 'claude-opus-4-7-20250805',
        upstreams: [{
          name: 'Anthropic',
          endpoint: 'https://api.anthropic.com',
          api_key: 'sk-ant-your-key-here',
          upstream_model: 'claude-opus-4-7-20250805',
          format: 'anthropic',
          timeoutMs: 120000,
        }],
      },
      'claude-sonnet-4-6': {
        model: 'claude-sonnet-4-6-20250701',
        upstreams: [{
          name: 'Anthropic',
          endpoint: 'https://api.anthropic.com',
          api_key: 'sk-ant-your-key-here',
          upstream_model: 'claude-sonnet-4-6-20250701',
          format: 'anthropic',
          timeoutMs: 120000,
        }],
      },
      'claude-haiku-4.5': {
        model: 'claude-haiku-4-5-20251001',
        upstreams: [{
          name: 'Anthropic',
          endpoint: 'https://api.anthropic.com',
          api_key: 'sk-ant-your-key-here',
          upstream_model: 'claude-haiku-4-5-20251001',
          format: 'anthropic',
          timeoutMs: 120000,
        }],
      },
    },
  });

  if (!result.success) {
    throw new Error(`Default config validation failed — this is a bug. ${result.error.message}`);
  }

  return result.data;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // ── CLI: status command ──
  if (args[0] === 'status') {
    showStatus();
    return;
  }

  let configPath: string;
  let created = false;
  try {
    const resolved = resolveConfigPath();
    configPath = resolved.path;

    if (!resolved.exists) {
      const dir = dirname(configPath);
      mkdirSync(dir, { recursive: true });
      const defaults = createDefaultConfig();
      await writeConfig(configPath, defaults);
      created = true;
    }
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const config = loadConfig(configPath);
  const configManager = new ConfigManager(config, configPath);

  const stateDir = config._configPath
    ? undefined
    : process.cwd();

  const sentimentState = new SentimentState(stateDir);
  const app = await createApp(configManager, sentimentState);

  app.listen({ port: configManager.config.server.port, host: configManager.config.server.host }, (err, address) => {
    if (err) {
      console.error('Failed to start:', (err as Error).message);
      process.exit(1);
    }

    const slots = Object.entries(configManager.config.model_slots)
      .map(([key, slot]) => `${key} → ${slot.model} (${slot.upstreams.length} upstreams)`)
      .join(', ');

    console.log(`SentiRoute v${VERSION}  ${address}`);
    console.log(`Config: ${configPath}${created ? ' (created with defaults)' : ''}`);
    console.log(`Slots: ${slots}`);
    console.log(`POST   ${address}/v1/messages`);
    console.log(`POST   ${address}/v1/chat/completions`);
    console.log(`GET    ${address}/health`);
    console.log(`Dashboard: ${address}/dashboard/`);
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`\n${signal} received — shutting down`);
    sentimentState.flush();
    app.close().then(() => process.exit(0));
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// ── Status command ──

function showStatus(): void {
  let configPath: string;
  try {
    const resolved = resolveConfigPath();
    if (!resolved.exists) {
      console.error('No config file found. Run the server first to create defaults, or set SENTIROUTE_CONFIG.');
      process.exit(1);
    }
    configPath = resolved.path;
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const config = loadConfig(configPath);
  const state = new SentimentState(config._configPath ? undefined : process.cwd());

  console.log(`SentiRoute v${VERSION}`);
  console.log(`Config: ${configPath}\n`);

  const sentimentCfg: SentimentConfig = config.sentiment ?? {
    threshold: 0.6, decayRate: 0.1, cooldownMs: 300000, antiFlapMs: 60000,
  };

  for (const [key, slotCfg] of Object.entries(config.model_slots)) {
    const slotState = state.getSlot(key);
    const upstreams = slotCfg.upstreams;
    const activeUpstream = upstreams[slotState.currentUpstreamIndex] ?? upstreams[0];
    const activeName = activeUpstream.name ?? `upstream-${slotState.currentUpstreamIndex}`;
    const warning = slotState.score > sentimentCfg.threshold ? ' !' : '';

    const cooldownRemaining = slotState.cooldownUntil
      ? Math.max(0, slotState.cooldownUntil - Date.now())
      : 0;
    const cooldownStr = cooldownRemaining > 0
      ? formatDuration(cooldownRemaining)
      : 'none';

    console.log(`${key} → ${slotCfg.model}`);
    console.log(`  Score:       ${slotState.score.toFixed(2)} / 1.00  (threshold: ${sentimentCfg.threshold})${warning}`);
    console.log(`  Upstream:    ${activeName}  (#${slotState.currentUpstreamIndex + 1} of ${upstreams.length})`);
    console.log(`  Cooldown:    ${cooldownStr}`);
    console.log(`  Triggers:    ${slotState.triggerCount}`);

    if (slotState.switchHistory.length) {
      console.log('  History:');
      for (const ev of slotState.switchHistory.slice(-5)) {
        const ts = new Date(ev.timestamp).toISOString().replace('T', ' ').slice(0, 19);
        console.log(`    ${ts}  #${ev.fromIndex}→#${ev.toIndex}  score:${ev.score.toFixed(2)}  ${ev.reason}`);
      }
    }
    console.log();
  }
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

main();
