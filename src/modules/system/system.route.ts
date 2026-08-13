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
};
