import type { FastifyInstance, FastifyRequest } from 'fastify';

import { API_PREFIX } from '../../config/constants';
import { AppError } from '../../shared/errors/app-error';
import { success } from '../../shared/http/response';
import { PushNotificationsRepository } from './push-notifications.repository';
import {
  deletePushTokenBodySchema,
  noContentResponseSchema,
  pushTokenResponseSchema,
  registerPushTokenBodySchema,
  type DeletePushTokenBody,
  type RegisterPushTokenBody,
} from './push-notifications.schema';
import { PushTokenService } from './push-notifications.service';

const identityFromRequest = (request: FastifyRequest): { userId: number; guildId: number } => {
  const userId = Number(request.user.sub);
  const guildId = request.user.guildId;
  if (
    !Number.isSafeInteger(userId) ||
    userId < 1 ||
    !Number.isSafeInteger(guildId) ||
    guildId < 1
  ) {
    throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
  }
  return { userId, guildId };
};

export const registerPushNotificationRoutes = async (app: FastifyInstance): Promise<void> => {
  const service = new PushTokenService(new PushNotificationsRepository(app.db));

  app.put(
    `${API_PREFIX}/push-tokens`,
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['push-notifications'],
        body: registerPushTokenBodySchema,
        response: { 200: pushTokenResponseSchema },
      },
    },
    async (request) => {
      const identity = identityFromRequest(request);
      return success(
        service.register(identity.userId, identity.guildId, request.body as RegisterPushTokenBody),
      );
    },
  );

  app.delete(
    `${API_PREFIX}/push-tokens`,
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['push-notifications'],
        body: deletePushTokenBodySchema,
        response: { 204: noContentResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = identityFromRequest(request);
      service.delete(
        identity.userId,
        identity.guildId,
        (request.body as DeletePushTokenBody).token,
      );
      return reply.code(204).send();
    },
  );
};
