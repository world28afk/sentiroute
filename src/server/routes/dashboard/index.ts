import type { FastifyPluginAsync } from 'fastify';
import type { ConfigManager } from '../../../config/manager.js';
import type { SentimentState } from '../../../sentiment/state.js';
import { configRoutes } from './config.js';
import { stateRoutes } from './state.js';
import { switchRoutes } from './switch.js';
import { controlRoutes } from './control.js';

export type DashboardOpts = { configManager: ConfigManager; sentimentState: SentimentState };

const dashboardPlugin: FastifyPluginAsync<DashboardOpts> = async (fastify, opts) => {
  await fastify.register(configRoutes, opts);
  await fastify.register(stateRoutes, opts);
  await fastify.register(switchRoutes, opts);
  await fastify.register(controlRoutes, opts);
};

Object.defineProperty(dashboardPlugin, 'name', { value: 'dashboard-api' });
export { dashboardPlugin as dashboardApi };
