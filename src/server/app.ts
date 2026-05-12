import Fastify from 'fastify';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from '../config/schema.js';
import type { ConfigManager } from '../config/manager.js';
import { SentimentState } from '../sentiment/state.js';
import { healthRoute } from './routes/health.js';
import { messagesRoute } from './routes/messages.js';
import { chatRoute } from './routes/chat.js';
import FastifyStatic from '@fastify/static';
import { dashboardApi } from './routes/dashboard/index.js';

export async function createApp(configManager: ConfigManager, sentimentState: SentimentState) {
  const app = Fastify({
    logger: {
      level: 'warn',
      base: undefined,
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
    },
  });

  const liveConfig: Config = configManager.config;
  const dataDir = liveConfig._configPath
    ? dirname(liveConfig._configPath)
    : process.cwd();

  const routeOpts = { config: liveConfig, dataDir, sentimentState };

  app.register(healthRoute, { config: liveConfig });
  app.register(messagesRoute, routeOpts);
  app.register(chatRoute, routeOpts);

  // ── Static file serving for dashboard ──
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const isProduction = __dirname.includes('/dist/') || __dirname.includes('\\dist\\');
  const dashboardRoot = isProduction
    ? join(__dirname, 'dashboard')          // dist/ -> dist/dashboard/
    : join(__dirname, '..', '..', 'dashboard'); // src/server/ -> dashboard/

  await app.register(FastifyStatic, {
    root: dashboardRoot,
    prefix: '/dashboard/',
    wildcard: false,
    index: ['index.html'],
    maxAge: '1h',
    immutable: false,
  });

  // ── Dashboard API routes ──
  await app.register(dashboardApi, { configManager, sentimentState });

  return app;
}
