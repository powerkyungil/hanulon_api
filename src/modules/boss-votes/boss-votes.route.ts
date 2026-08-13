import type { FastifyInstance, FastifyRequest } from 'fastify';

import { API_PREFIX } from '../../config/constants';
import { AppError } from '../../shared/errors/app-error';
import { success } from '../../shared/http/response';
import { BossesRepository } from '../bosses/bosses.repository';
import { BossesService } from '../bosses/bosses.service';
import { SchedulesRepository } from '../schedules/schedules.repository';
import { SchedulesService } from '../schedules/schedules.service';
import { BossVotesRepository } from './boss-votes.repository';
import {
  legacyCreatedResponseSchema,
  legacyToggleResponseSchema,
  legacyVoteListResponseSchema,
  manualVoteBodySchema,
  v1CreatedResponseSchema,
  v1ToggleResponseSchema,
  v1VoteListResponseSchema,
  voteParamsSchema,
  voteToggleBodySchema,
  type ManualVoteBody,
  type VoteParams,
  type VoteToggleBody,
} from './boss-votes.schema';
import { BossVotesService } from './boss-votes.service';

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

export const registerBossVoteRoutes = async (
  app: FastifyInstance,
  retentionDays: number,
): Promise<void> => {
  const bossesService = new BossesService(new BossesRepository(app.db));
  const schedulesService = new SchedulesService(
    new SchedulesRepository(app.db),
    bossesService,
    retentionDays,
  );
  const service = new BossVotesService(new BossVotesRepository(app.db), schedulesService);

  const registerRoutes = (
    urls: { votes: string; manual: string; toggle: string },
    style: ResponseStyle,
  ): void => {
    app.get(
      urls.votes,
      {
        config: routeConfig(style),
        preHandler: app.authenticate,
        schema: {
          tags: ['boss-votes'],
          response: {
            200: style === 'v1' ? v1VoteListResponseSchema : legacyVoteListResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const votes = service.getVotes(identity.userId, identity.guildId);
        return reply.send(style === 'v1' ? success(votes) : votes);
      },
    );

    app.post(
      urls.manual,
      {
        config: routeConfig(style),
        preHandler: app.authenticate,
        schema: {
          tags: ['boss-votes'],
          body: manualVoteBodySchema,
          response: {
            [style === 'v1' ? 201 : 200]:
              style === 'v1' ? v1CreatedResponseSchema : legacyCreatedResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const body = request.body as ManualVoteBody;
        const id = service.createManualVote(identity.userId, identity.guildId, body);
        return style === 'v1'
          ? reply.code(201).send(success({ id, voteKey: `manual|${id}` }))
          : reply.send({ success: true, id });
      },
    );

    app.route({
      method: style === 'v1' ? 'PUT' : 'POST',
      url: urls.toggle,
      config: routeConfig(style),
      preHandler: app.authenticate,
      schema: {
        tags: ['boss-votes'],
        params: voteParamsSchema,
        body: voteToggleBodySchema,
        response: {
          200: style === 'v1' ? v1ToggleResponseSchema : legacyToggleResponseSchema,
        },
      },
      handler: async (request, reply) => {
        const identity = identityFromRequest(request);
        const params = request.params as VoteParams;
        const body = request.body as VoteToggleBody;
        const joined = service.toggleParticipation(
          identity.userId,
          identity.guildId,
          params.voteKey,
          body.boss,
          body.spawnTime,
        );
        return reply.send(style === 'v1' ? success({ joined }) : { joined });
      },
    });
  };

  registerRoutes(
    {
      votes: `${API_PREFIX}/boss-votes`,
      manual: `${API_PREFIX}/boss-votes/manual`,
      toggle: `${API_PREFIX}/boss-votes/:voteKey/participation`,
    },
    'v1',
  );
  registerRoutes(
    {
      votes: '/api/vote-bosses',
      manual: '/api/vote-bosses/manual',
      toggle: '/api/vote-participants/:voteKey',
    },
    'legacy',
  );
};
