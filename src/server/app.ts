import Fastify from 'fastify';
import { dirname } from 'node:path';
import type { Config } from '../config/schema.js';
import { SentimentState } from '../sentiment/state.js';
import { healthRoute } from './routes/health.js';
import { messagesRoute } from './routes/messages.js';
import { chatRoute } from './routes/chat.js';

export function createApp(config: Config, sentimentState: SentimentState) {
  const app = Fastify({
    logger: {
      level: 'warn',
      base: undefined,
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
    },
  });

  const dataDir = config._configPath
    ? dirname(config._configPath)
    : process.cwd();

  const routeOpts = { config, dataDir, sentimentState };

  app.register(healthRoute, { config });
  app.register(messagesRoute, routeOpts);
  app.register(chatRoute, routeOpts);

  return app;
}
