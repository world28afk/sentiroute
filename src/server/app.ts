import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from '../config/schema.js';
import type { ConfigManager } from '../config/manager.js';
import { SentimentState } from '../sentiment/state.js';
import { createAIAnalyzer, type AIAnalyzer } from '../sentiment/ai-analyzer.js';
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

  const aiAnalyzer: AIAnalyzer = createAIAnalyzer(liveConfig.sentiment?.aiAnalyzer);

  const routeOpts = { config: liveConfig, dataDir, sentimentState, aiAnalyzer };

  // ── Auth middleware: protect proxy endpoints with server.api_key ──
  const exemptPrefixes = ['/health', '/dashboard/', '/api/dashboard/'];
  app.addHook('onRequest', async (request, reply) => {
    const requiredKey = liveConfig.server?.api_key;
    if (!requiredKey) return; // no key configured — allow all

    const path = request.url.split('?')[0];
    if (exemptPrefixes.some((p) => path.startsWith(p))) return;

    // Check Authorization: Bearer <key>
    const auth = request.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const token = auth.slice(7).trim();
      if (token === requiredKey) return;
    }

    // Check x-api-key header
    const xKey = request.headers['x-api-key'];
    if (xKey === requiredKey) return;

    return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or missing API key' });
  });

  app.register(healthRoute, { config: liveConfig });
  app.register(messagesRoute, routeOpts);
  app.register(chatRoute, routeOpts);

  // ── Static file serving for dashboard ──
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const distDashboard = join(__dirname, 'dashboard');
  const srcDashboard = join(__dirname, '..', '..', 'dashboard');
  const dashboardRoot = existsSync(distDashboard) ? distDashboard : srcDashboard;

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
