import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { API_PREFIX } from '../../config/constants';
import { AppError } from '../../shared/errors/app-error';
import { success } from '../../shared/http/response';
import { BossesRepository } from './bosses.repository';
import {
  bossParamsSchema,
  legacyBossBodySchema,
  legacyBossCreatedResponseSchema,
  legacyBossListResponseSchema,
  legacyBossOrderSchema,
  legacySuccessResponseSchema,
  noContentResponseSchema,
  v1BossBodySchema,
  v1BossListResponseSchema,
  v1BossOrderSchema,
  v1BossResponseSchema,
  type BossParams,
  type LegacyBossBody,
  type LegacyBossOrderBody,
  type V1BossBody,
  type V1BossOrderBody,
} from './bosses.schema';
import { BossesService } from './bosses.service';
import type { BossDefinition, BossDefinitionInput } from './bosses.types';

type ResponseStyle = 'v1' | 'legacy';
const routeConfig = (responseStyle: ResponseStyle) => ({ responseStyle });

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

const toV1Boss = (definition: BossDefinition) => ({
  id: definition.id,
  type: definition.type,
  region: definition.region,
  boss: definition.boss,
  cooldownHours: definition.cooldownHours,
  timeText: definition.timeText,
  days: definition.days?.split(',').filter(Boolean) ?? [],
  color: definition.color,
  sortOrder: definition.sortOrder,
});

const toLegacyBoss = (definition: BossDefinition) => ({
  id: definition.id,
  type: definition.type,
  region: definition.region,
  boss: definition.boss,
  cooldown: definition.cooldownHours,
  timeStr: definition.timeText,
  days: definition.days,
  color: definition.color,
  sort_order: definition.sortOrder,
});

const inputFromRequest = (request: FastifyRequest, style: ResponseStyle): BossDefinitionInput => {
  if (style === 'v1') {
    const body = request.body as V1BossBody;
    return {
      type: body.type,
      region: body.region,
      boss: body.boss,
      cooldownHours: body.cooldownHours,
      timeText: body.timeText ?? null,
      days: body.days?.join(',') ?? null,
      color: body.color ?? null,
    };
  }
  const body = request.body as LegacyBossBody;
  return {
    type: body.type,
    region: body.region ?? '공통',
    boss: body.boss,
    cooldownHours: body.cooldown ?? 0,
    timeText: body.timeStr ?? null,
    days: body.days ?? null,
    color: body.color ?? null,
  };
};

export const registerBossRoutes = async (app: FastifyInstance): Promise<void> => {
  const service = new BossesService(new BossesRepository(app.db));

  const registerRoutes = (
    urls: { base: string; reorder: string; reset: string },
    style: ResponseStyle,
  ): void => {
    app.get(
      urls.base,
      {
        config: routeConfig(style),
        preHandler: app.authenticate,
        schema: {
          tags: ['bosses'],
          response: {
            200: style === 'v1' ? v1BossListResponseSchema : legacyBossListResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const definitions = service.getDefinitions(identity.userId, identity.guildId);
        return reply.send(
          style === 'v1' ? success(definitions.map(toV1Boss)) : definitions.map(toLegacyBoss),
        );
      },
    );

    app.post(
      urls.base,
      {
        config: routeConfig(style),
        preHandler: app.authenticate,
        schema: {
          tags: ['bosses'],
          body: style === 'v1' ? v1BossBodySchema : legacyBossBodySchema,
          response: {
            [style === 'v1' ? 201 : 200]:
              style === 'v1' ? v1BossResponseSchema : legacyBossCreatedResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const definition = service.createDefinition(
          identity.userId,
          identity.guildId,
          inputFromRequest(request, style),
        );
        return style === 'v1'
          ? reply.code(201).send(success(toV1Boss(definition)))
          : reply.send({ success: true, id: definition.id });
      },
    );

    app.delete(
      `${urls.base}/:id`,
      {
        config: routeConfig(style),
        preHandler: app.authenticate,
        schema: {
          tags: ['bosses'],
          params: bossParamsSchema,
          response: {
            [style === 'v1' ? 204 : 200]:
              style === 'v1' ? noContentResponseSchema : legacySuccessResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        service.deleteDefinition(
          identity.userId,
          identity.guildId,
          (request.params as BossParams).id,
        );
        return sendMutation(reply, style);
      },
    );

    app.route({
      method: style === 'v1' ? 'PUT' : 'POST',
      url: urls.reorder,
      config: routeConfig(style),
      preHandler: app.authenticate,
      schema: {
        tags: ['bosses'],
        body: style === 'v1' ? v1BossOrderSchema : legacyBossOrderSchema,
        response: {
          [style === 'v1' ? 204 : 200]:
            style === 'v1' ? noContentResponseSchema : legacySuccessResponseSchema,
        },
      },
      handler: async (request, reply) => {
        const identity = identityFromRequest(request);
        if (style === 'v1') {
          service.reorderByIds(
            identity.userId,
            identity.guildId,
            (request.body as V1BossOrderBody).bossIds,
          );
        } else {
          service.reorderByBossNames(
            identity.userId,
            identity.guildId,
            (request.body as LegacyBossOrderBody).orderList.map((item) => ({
              boss: item.boss,
              sortOrder: item.sort_order,
            })),
          );
        }
        return sendMutation(reply, style);
      },
    });

    app.post(
      urls.reset,
      {
        config: routeConfig(style),
        preHandler: app.authenticate,
        schema: {
          tags: ['bosses'],
          response: {
            [style === 'v1' ? 204 : 200]:
              style === 'v1' ? noContentResponseSchema : legacySuccessResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        service.resetDefinitions(identity.userId, identity.guildId);
        return sendMutation(reply, style);
      },
    );
  };

  registerRoutes(
    {
      base: `${API_PREFIX}/bosses`,
      reorder: `${API_PREFIX}/bosses/order`,
      reset: `${API_PREFIX}/bosses/reset`,
    },
    'v1',
  );
  registerRoutes(
    {
      base: '/api/custom-bosses',
      reorder: '/api/custom-bosses/reorder',
      reset: '/api/admin/reset-bosses',
    },
    'legacy',
  );
};

const sendMutation = (reply: FastifyReply, style: ResponseStyle) =>
  style === 'v1' ? reply.code(204).send() : reply.send({ success: true as const });
