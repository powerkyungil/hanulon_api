import type { FastifyInstance } from 'fastify';

import { API_PREFIX, DEFAULT_TIME_ZONE } from '../../config/constants';
import { success } from '../../shared/http/response';
import { timeResponseSchema } from './system.schema';

export const registerSystemRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get(
    `${API_PREFIX}/time`,
    {
      schema: {
        tags: ['system'],
        response: {
          200: timeResponseSchema,
        },
      },
    },
    async () =>
      success({
        epochMs: Date.now(),
        timeZone: DEFAULT_TIME_ZONE as 'Asia/Seoul',
      }),
  );

  app.get(
    '/api/time',
    {
      config: { responseStyle: 'legacy' },
      schema: {
        tags: ['system'],
        response: {
          200: {
            type: 'object',
            required: ['serverTime', 'timeZone'],
            properties: {
              serverTime: { type: 'integer', minimum: 0 },
              timeZone: { type: 'string' },
            },
          },
        },
      },
    },
    async () => ({ serverTime: Date.now(), timeZone: DEFAULT_TIME_ZONE }),
  );
};
