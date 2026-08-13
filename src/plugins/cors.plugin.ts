import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config/env';

export const registerCors = async (app: FastifyInstance, config: AppConfig): Promise<void> => {
  await app.register(cors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    credentials: false,
  });
};
