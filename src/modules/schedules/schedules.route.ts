import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { API_PREFIX } from '../../config/constants';
import { AppError } from '../../shared/errors/app-error';
import { success } from '../../shared/http/response';
import { BossesRepository } from '../bosses/bosses.repository';
import { BossesService } from '../bosses/bosses.service';
import { SchedulesRepository } from './schedules.repository';
import {
  legacyNextSpawnResponseSchema,
  legacyScheduleListBodySchema,
  legacyScheduleListResponseSchema,
  legacySuccessResponseSchema,
  legacyTargetListResponseSchema,
  legacyToggleResponseSchema,
  noContentResponseSchema,
  participantMapSchema,
  participantParamsSchema,
  legacyParticipationTargetsBodySchema,
  participationToggleBodySchema,
  scheduleKeyBodySchema,
  scheduleMungBodySchema,
  scheduleParamsSchema,
  v1CreatedResponseSchema,
  v1ParticipationTargetsBodySchema,
  v1NextSpawnResponseSchema,
  v1ParticipantMapResponseSchema,
  v1ScheduleListBodySchema,
  v1ScheduleListResponseSchema,
  v1StringSetResponseSchema,
  v1TargetListResponseSchema,
  v1ToggleResponseSchema,
  type LegacyScheduleListBody,
  type ParticipantParams,
  type LegacyParticipationTargetsBody,
  type ParticipationToggleBody,
  type ScheduleKeyBody,
  type ScheduleMungBody,
  type ScheduleParams,
  type V1ScheduleListBody,
  type V1ParticipationTargetsBody,
} from './schedules.schema';
import { SchedulesService } from './schedules.service';
import type { BossSchedule, ScheduleInput } from './schedules.types';

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

const toLegacySchedule = (schedule: BossSchedule) => ({
  id: schedule.id,
  type: schedule.type,
  region: schedule.region,
  boss: schedule.boss,
  spawnTime: schedule.spawnTime,
  is_mung: schedule.isMung ? 1 : 0,
  isFixed: false as const,
});

const toV1Schedule = (schedule: BossSchedule) => ({
  id: schedule.id,
  bossDefinitionId: schedule.bossDefinitionId,
  type: schedule.type,
  region: schedule.region,
  boss: schedule.boss,
  spawnTime: schedule.spawnTime,
  isMung: schedule.isMung,
  isFixed: false as const,
});

export const registerScheduleRoutes = async (
  app: FastifyInstance,
  retentionDays: number,
): Promise<void> => {
  const service = new SchedulesService(
    new SchedulesRepository(app.db),
    new BossesService(new BossesRepository(app.db)),
    retentionDays,
  );

  const registerRoutes = (
    urls: {
      schedules: string;
      cut: string;
      mung: string;
      reset: string;
      targets: string;
      participants: string;
      states: string;
    },
    style: ResponseStyle,
  ): void => {
    const mutationOptions = (params?: object) => ({
      config: routeConfig(style),
      preHandler: app.authenticate,
      schema: {
        tags: ['schedules'],
        ...(params ? { params } : {}),
        response: {
          [style === 'v1' ? 204 : 200]:
            style === 'v1' ? noContentResponseSchema : legacySuccessResponseSchema,
        },
      },
    });

    app.get(
      urls.schedules,
      {
        config: routeConfig(style),
        preHandler: app.authenticate,
        schema: {
          tags: ['schedules'],
          response: {
            200: style === 'v1' ? v1ScheduleListResponseSchema : legacyScheduleListResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const schedules = service.getSchedules(identity.userId, identity.guildId);
        return reply.send(
          style === 'v1' ? success(schedules.map(toV1Schedule)) : schedules.map(toLegacySchedule),
        );
      },
    );

    app.post(
      urls.schedules,
      {
        config: routeConfig(style),
        preHandler: app.authenticate,
        schema: {
          tags: ['schedules'],
          body: style === 'v1' ? v1ScheduleListBodySchema : legacyScheduleListBodySchema,
          response: {
            [style === 'v1' ? 201 : 200]:
              style === 'v1' ? v1CreatedResponseSchema : legacySuccessResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const schedules =
          style === 'v1'
            ? (request.body as V1ScheduleListBody).schedules
            : (request.body as LegacyScheduleListBody);
        service.saveSchedules(identity.userId, identity.guildId, schedules as ScheduleInput[]);
        return style === 'v1'
          ? reply.code(201).send(success({ createdCount: schedules.length }))
          : reply.send({ success: true });
      },
    );

    const registerNextSpawnAction = (url: string, action: 'cut' | 'mung'): void => {
      app.post(
        url,
        {
          config: routeConfig(style),
          preHandler: app.authenticate,
          schema: {
            tags: ['schedules'],
            body: action === 'cut' ? scheduleKeyBodySchema : scheduleMungBodySchema,
            response: {
              200: style === 'v1' ? v1NextSpawnResponseSchema : legacyNextSpawnResponseSchema,
            },
          },
        },
        async (request, reply) => {
          const identity = identityFromRequest(request);
          const body = request.body as ScheduleKeyBody | ScheduleMungBody;
          const nextSpawn =
            action === 'cut'
              ? service.cut(identity.userId, identity.guildId, body)
              : service.mung(identity.userId, identity.guildId, {
                  type: body.type,
                  region: body.region,
                  boss: body.boss,
                  spawnTime: (body as ScheduleMungBody).currentSpawnTime,
                });
          return reply.send(
            style === 'v1' ? success({ nextSpawnTime: nextSpawn }) : { success: true, nextSpawn },
          );
        },
      );
    };
    registerNextSpawnAction(urls.cut, 'cut');
    registerNextSpawnAction(urls.mung, 'mung');

    app.delete(
      `${urls.schedules}/:id`,
      mutationOptions(scheduleParamsSchema),
      async (request, reply) => {
        const identity = identityFromRequest(request);
        service.deleteSchedule(
          identity.userId,
          identity.guildId,
          (request.params as ScheduleParams).id,
        );
        return sendMutation(reply, style);
      },
    );

    app.delete(urls.reset, mutationOptions(), async (request, reply) => {
      const identity = identityFromRequest(request);
      service.resetSchedules(identity.userId, identity.guildId);
      return sendMutation(reply, style);
    });

    app.get(
      urls.targets,
      {
        config: routeConfig(style),
        preHandler: app.authenticate,
        schema: {
          tags: ['schedules'],
          response: {
            200: style === 'v1' ? v1TargetListResponseSchema : legacyTargetListResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const targets =
          style === 'v1'
            ? { bossDefinitionIds: service.getTargetDefinitionIds(identity.userId, identity.guildId) }
            : service.getTargetBosses(identity.userId, identity.guildId);
        return reply.send(style === 'v1' ? success(targets) : targets);
      },
    );

    app.route({
      method: style === 'v1' ? 'PUT' : 'POST',
      url: urls.targets,
      config: routeConfig(style),
      preHandler: app.authenticate,
      schema: {
        tags: ['schedules'],
        body:
          style === 'v1'
            ? v1ParticipationTargetsBodySchema
            : legacyParticipationTargetsBodySchema,
        response: {
          [style === 'v1' ? 204 : 200]:
            style === 'v1' ? noContentResponseSchema : legacySuccessResponseSchema,
        },
      },
      handler: async (request, reply) => {
        const identity = identityFromRequest(request);
        if (style === 'v1') {
          service.replaceTargetDefinitionIds(
            identity.userId,
            identity.guildId,
            (request.body as V1ParticipationTargetsBody).bossDefinitionIds,
          );
        } else {
          service.replaceTargetBosses(
            identity.userId,
            identity.guildId,
            (request.body as LegacyParticipationTargetsBody).bosses,
          );
        }
        return sendMutation(reply, style);
      },
    });

    app.get(
      urls.participants,
      {
        config: routeConfig(style),
        preHandler: app.authenticate,
        schema: {
          tags: ['schedules'],
          response: { 200: style === 'v1' ? v1ParticipantMapResponseSchema : participantMapSchema },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const participants = service.getParticipants(identity.userId, identity.guildId);
        return reply.send(style === 'v1' ? success(participants) : participants);
      },
    );

    app.route({
      method: style === 'v1' ? 'PUT' : 'POST',
      url: `${urls.participants}/:boss`,
      config: routeConfig(style),
      preHandler: app.authenticate,
      schema: {
        tags: ['schedules'],
        params: participantParamsSchema,
        body: participationToggleBodySchema,
        response: { 200: style === 'v1' ? v1ToggleResponseSchema : legacyToggleResponseSchema },
      },
      handler: async (request, reply) => {
        const identity = identityFromRequest(request);
        const body = request.body as ParticipationToggleBody;
        const joined = service.toggleParticipation(identity.userId, identity.guildId, {
          ...body,
          boss: (request.params as ParticipantParams).boss,
        });
        return reply.send(style === 'v1' ? success({ joined }) : { joined });
      },
    });

    app.get(
      urls.states,
      {
        config: routeConfig(style),
        preHandler: app.authenticate,
        schema: {
          tags: ['schedules'],
          response: {
            200: style === 'v1' ? v1StringSetResponseSchema : legacyTargetListResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const keys = service.getClosedVoteKeys(identity.userId, identity.guildId);
        return reply.send(style === 'v1' ? success(keys) : keys);
      },
    );
  };

  registerRoutes(
    {
      schedules: `${API_PREFIX}/schedules`,
      cut: `${API_PREFIX}/schedules/cut`,
      mung: `${API_PREFIX}/schedules/mung`,
      reset: `${API_PREFIX}/schedules`,
      targets: `${API_PREFIX}/participation-targets`,
      participants: `${API_PREFIX}/participants`,
      states: `${API_PREFIX}/participation-states`,
    },
    'v1',
  );
  registerRoutes(
    {
      schedules: '/api/schedules',
      cut: '/api/schedules/cut',
      mung: '/api/schedules/mung',
      reset: '/api/schedules-all',
      targets: '/api/participation-targets',
      participants: '/api/participants',
      states: '/api/participation-states',
    },
    'legacy',
  );
};

const sendMutation = (reply: FastifyReply, style: ResponseStyle) =>
  style === 'v1' ? reply.code(204).send() : reply.send({ success: true as const });
