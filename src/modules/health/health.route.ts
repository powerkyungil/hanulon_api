import type { FastifyInstance } from 'fastify';

import { API_PREFIX } from '../../config/constants';
import { success } from '../../shared/http/response';
import {
  healthResponseSchema,
  readinessResponseSchema,
  readinessUnavailableResponseSchema,
} from './health.schema';

export const registerHealthRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get(
    `${API_PREFIX}/health/live`,
    {
      schema: {
        tags: ['health'],
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => success({ status: 'ok' as const }),
  );

  app.get(
    `${API_PREFIX}/health/ready`,
    {
      schema: {
        tags: ['health'],
        response: {
          200: readinessResponseSchema,
          503: readinessUnavailableResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const database = request.server.db;
      const result = database
        .prepare(
          "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
        )
        .get() as { ok: number } | undefined;

      if (!result || result.ok !== 1) {
        reply.code(503);
        return {
          error: {
            code: 'DATABASE_NOT_READY',
            message: '데이터베이스가 준비되지 않았습니다.',
            details: null,
            requestId: request.id,
          },
        };
      }

      return success({
        status: 'ready' as const,
        database: 'ok' as const,
        migrationsApplied: request.server.migrationsApplied,
      });
    },
  );
};
