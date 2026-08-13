import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { API_PREFIX } from '../../config/constants';
import { AppError } from '../../shared/errors/app-error';
import { success } from '../../shared/http/response';
import { SiegeRepository } from './siege.repository';
import {
  legacySiegeInputSchema,
  legacySiegeListResponseSchema,
  legacySuccessResponseSchema,
  noContentResponseSchema,
  siegeMemberParamsSchema,
  v1SiegeInputSchema,
  v1SiegeListResponseSchema,
  type LegacySiegeInputBody,
  type SiegeMemberParams,
  type V1SiegeInputBody,
} from './siege.schema';
import { SiegeService } from './siege.service';
import type { SiegeInput, SiegeRecord } from './siege.types';

type ResponseStyle = 'v1' | 'legacy';

interface SiegeRouteConfig {
  responseStyle: ResponseStyle;
}

const routeConfig = (responseStyle: ResponseStyle): SiegeRouteConfig => ({ responseStyle });

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

const toV1Record = (record: SiegeRecord) => ({
  userId: record.userId,
  nickname: record.nickname,
  mainClass: record.mainClass,
  combatPower: record.combatPower,
  currentDiamonds: record.currentDiamonds,
  remainingDiamonds: record.remainingDiamonds,
  usedDiamonds: record.currentDiamonds - record.remainingDiamonds,
  updatedAt: record.updatedAt,
});

const toLegacyRecord = (record: SiegeRecord) => ({
  id: record.userId,
  nickname: record.nickname,
  main_class: record.mainClass,
  combat_power: record.combatPower,
  current_diamonds: record.currentDiamonds,
  remaining_diamonds: record.remainingDiamonds,
  updated_at: record.updatedAt === null ? null : new Date(record.updatedAt).toISOString(),
});

const inputFromRequest = (request: FastifyRequest, responseStyle: ResponseStyle): SiegeInput => {
  if (responseStyle === 'v1') {
    const body = request.body as V1SiegeInputBody;
    return {
      currentDiamonds: body.currentDiamonds,
      remainingDiamonds: body.remainingDiamonds,
    };
  }
  const body = request.body as LegacySiegeInputBody;
  return {
    currentDiamonds: body.current_diamonds,
    remainingDiamonds: body.remaining_diamonds,
  };
};

export const registerSiegeRoutes = async (app: FastifyInstance): Promise<void> => {
  const service = new SiegeService(new SiegeRepository(app.db));

  const registerRoutes = (
    urls: { list: string; mine: string; member: string; reset: string },
    responseStyle: ResponseStyle,
  ): void => {
    app.get(
      urls.list,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['siege'],
          response: {
            200: responseStyle === 'v1' ? v1SiegeListResponseSchema : legacySiegeListResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const records = service.getRecords(identity.userId, identity.guildId);
        return reply.send(
          responseStyle === 'v1' ? success(records.map(toV1Record)) : records.map(toLegacyRecord),
        );
      },
    );

    const mutationResponseSchema =
      responseStyle === 'v1' ? noContentResponseSchema : legacySuccessResponseSchema;
    const mutationStatusCode = responseStyle === 'v1' ? 204 : 200;
    const mutationOptions = {
      config: routeConfig(responseStyle),
      preHandler: app.authenticate,
      schema: {
        tags: ['siege'],
        body: responseStyle === 'v1' ? v1SiegeInputSchema : legacySiegeInputSchema,
        response: { [mutationStatusCode]: mutationResponseSchema },
      },
    };
    const sendMutationResponse = (reply: FastifyReply) =>
      responseStyle === 'v1' ? reply.code(204).send() : reply.send({ success: true as const });

    app.put(urls.mine, mutationOptions, async (request, reply) => {
      const identity = identityFromRequest(request);
      service.saveMine(identity.userId, identity.guildId, inputFromRequest(request, responseStyle));
      return sendMutationResponse(reply);
    });

    app.put(
      urls.member,
      {
        ...mutationOptions,
        schema: {
          ...mutationOptions.schema,
          params: siegeMemberParamsSchema,
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const params = request.params as SiegeMemberParams;
        service.saveMember(
          identity.userId,
          identity.guildId,
          params.id,
          inputFromRequest(request, responseStyle),
        );
        return sendMutationResponse(reply);
      },
    );

    app.delete(
      urls.reset,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['siege'],
          response: { [mutationStatusCode]: mutationResponseSchema },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        service.resetAll(identity.userId, identity.guildId);
        return sendMutationResponse(reply);
      },
    );
  };

  registerRoutes(
    {
      list: `${API_PREFIX}/siege`,
      mine: `${API_PREFIX}/siege/me`,
      member: `${API_PREFIX}/siege/members/:id`,
      reset: `${API_PREFIX}/siege`,
    },
    'v1',
  );
  registerRoutes(
    {
      list: '/api/siege',
      mine: '/api/siege/me',
      member: '/api/admin/siege/:id',
      reset: '/api/siege/all',
    },
    'legacy',
  );
};
