import type { FastifyInstance, FastifyRequest } from 'fastify';

import { API_PREFIX } from '../../config/constants';
import { AppError } from '../../shared/errors/app-error';
import { success } from '../../shared/http/response';
import { MemberDelegationsRepository } from './member-delegations.repository';
import {
  memberDelegationCreateBodySchema,
  memberDelegationListResponseSchema,
  memberDelegationParamsSchema,
  memberDelegationResponseSchema,
  memberDelegationSessionBodySchema,
  memberDelegationSessionResponseSchema,
  noContentResponseSchema,
  type MemberDelegationCreateBody,
  type MemberDelegationParams,
  type MemberDelegationSessionBody,
} from './member-delegations.schema';
import { MemberDelegationsService } from './member-delegations.service';

const memberIdentity = (request: FastifyRequest): { userId: number; guildId: number } => {
  if (request.user.principalType && request.user.principalType !== 'USER') {
    throw new AppError(
      'MEMBER_DELEGATION_SESSION_FORBIDDEN',
      '부주 세션에서는 부주 관계를 관리할 수 없습니다.',
      403,
    );
  }
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

export const registerMemberDelegationRoutes = async (app: FastifyInstance): Promise<void> => {
  const repository = new MemberDelegationsRepository(app.db);
  const service = new MemberDelegationsService(repository, app.db);

  app.get(
    `${API_PREFIX}/member-delegations`,
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['member-delegations'],
        response: { 200: memberDelegationListResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = memberIdentity(request);
      return reply.send(success(service.list(identity.userId, identity.guildId)));
    },
  );

  app.post(
    `${API_PREFIX}/member-delegations`,
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['member-delegations'],
        body: memberDelegationCreateBodySchema,
        response: { 201: memberDelegationResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = memberIdentity(request);
      const body = request.body as MemberDelegationCreateBody;
      const delegation = service.grant(identity.userId, identity.guildId, body.deputyUserId);
      return reply.code(201).send(success(delegation));
    },
  );

  app.delete(
    `${API_PREFIX}/member-delegations/:deputyUserId`,
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['member-delegations'],
        params: memberDelegationParamsSchema,
        response: { 204: noContentResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = memberIdentity(request);
      const params = request.params as MemberDelegationParams;
      service.revoke(identity.userId, identity.guildId, params.deputyUserId);
      return reply.code(204).send();
    },
  );

  app.post(
    `${API_PREFIX}/member-delegations/session`,
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['member-delegations'],
        body: memberDelegationSessionBodySchema,
        response: { 200: memberDelegationSessionResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = memberIdentity(request);
      const body = request.body as MemberDelegationSessionBody;
      const session = service.createSession(
        identity.userId,
        identity.guildId,
        body.ownerUserId,
        body.characterKey,
      );
      const token = app.jwt.sign({
        sub: String(session.owner.id),
        guildId: session.owner.guildId,
        role: 'MEMBER',
        username: session.owner.username,
        nickname: session.owner.nickname,
        principalType: 'MEMBER_DEPUTY',
        principalId: session.deputy.id,
        delegatedUserId: session.owner.id,
        actorUsername: session.deputy.username,
        actorNickname: session.deputy.nickname,
        activeCharacterKey: session.activeCharacter.characterKey,
        activeCharacterOwnerUserId: session.activeCharacter.ownerUserId,
        activeCharacterType: session.activeCharacter.characterType,
        activeCharacterName: session.activeCharacter.characterName,
      });
      return reply.send(
        success({
          token,
          guildId: session.owner.guildId,
          ownerUserId: session.owner.id,
          ownerUsername: session.owner.username,
          ownerNickname: session.owner.nickname,
          deputyUserId: session.deputy.id,
          deputyUsername: session.deputy.username,
          deputyNickname: session.deputy.nickname,
          activeCharacter: session.activeCharacter,
          principalType: 'MEMBER_DEPUTY' as const,
        }),
      );
    },
  );
};
