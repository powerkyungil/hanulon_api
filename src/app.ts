import Fastify, { type FastifyInstance } from 'fastify';

import type { AppConfig } from './config/env';
import { openDatabase } from './infrastructure/db/client';
import { registerBossRoutes } from './modules/bosses/bosses.route';
import { registerBossVoteRoutes } from './modules/boss-votes/boss-votes.route';
import { registerAuth } from './plugins/auth.plugin';
import { registerCors } from './plugins/cors.plugin';
import { registerErrorHandler } from './plugins/error.plugin';
import { registerRequestContext } from './plugins/request-context.plugin';
import { registerAuthRoutes } from './modules/auth/auth.route';
import { registerCollectionRoutes } from './modules/collections/collections.route';
import { registerContentGroupRoutes } from './modules/content-groups/content-groups.route';
import { registerGuildRoutes } from './modules/guild/guild.route';
import { registerHealthRoutes } from './modules/health/health.route';
import { registerMemberRoutes } from './modules/members/members.route';
import { registerNoticeRoutes } from './modules/notices/notices.route';
import { registerScheduleRoutes } from './modules/schedules/schedules.route';
import { registerSiegeRoutes } from './modules/siege/siege.route';
import { registerSupportRoutes } from './modules/support/support.route';
import { registerSystemRoutes } from './modules/system/system.route';

export interface BuildAppOptions {
  logger?: boolean;
}

export const buildApp = async (
  config: AppConfig,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> => {
  const app = Fastify({
    logger:
      options.logger === undefined
        ? config.nodeEnv === 'test'
          ? false
          : { level: config.logLevel }
        : options.logger,
    requestIdHeader: 'x-request-id',
    bodyLimit: 5 * 1024 * 1024,
  });

  const databaseContext = openDatabase(config);
  app.decorate('db', databaseContext.db);
  app.decorate('migrationsApplied', databaseContext.migrationsApplied);
  app.addHook('onClose', async () => {
    databaseContext.db.close();
  });

  registerErrorHandler(app);
  registerRequestContext(app);
  await registerCors(app, config);
  await registerAuth(app, config);
  await registerAuthRoutes(app);
  await registerBossRoutes(app);
  await registerBossVoteRoutes(app, config.bossHistoryRetentionDays);
  await registerCollectionRoutes(app);
  await registerContentGroupRoutes(app);
  await registerGuildRoutes(app);
  await registerMemberRoutes(app);
  await registerNoticeRoutes(app);
  await registerScheduleRoutes(app, config.bossHistoryRetentionDays);
  await registerSiegeRoutes(app);
  await registerSupportRoutes(app);
  await registerHealthRoutes(app);
  await registerSystemRoutes(app);

  return app;
};
