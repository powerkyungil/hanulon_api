import type { FastifyInstance, FastifyRequest } from 'fastify';

import { API_PREFIX } from '../../config/constants';
import { AppError } from '../../shared/errors/app-error';
import { success } from '../../shared/http/response';
import { DeputyAccountsRepository } from './deputy-accounts.repository';
import {
  deputyAccountListResponseSchema,
  deputyAccountParamsSchema,
  deputyActiveBodySchema,
  deputyCharactersResponseSchema,
  deputyCreateBodySchema,
  deputyCreatedResponseSchema,
  deputyLoginBodySchema,
  deputyLoginResponseSchema,
  deputyPasswordBodySchema,
  deputySelectCharacterBodySchema,
  deputyCharacterResponseSchema,
  noContentResponseSchema,
  type DeputyAccountParams,
  type DeputyActiveBody,
  type DeputyCreateBody,
  type DeputyLoginBody,
  type DeputyPasswordBody,
  type DeputySelectCharacterBody,
} from './deputy-accounts.schema';
import { DeputyAccountsService } from './deputy-accounts.service';

const DEPUTY_PERMISSIONS = [
  'BOSS_SCHEDULE_READ',
  'BOSS_PARTICIPATION',
  'BOSS_VOTE',
  'SUPPORT_MATCHING',
  'CONTENT_PARTICIPATION_READ',
];

const accountIdentity = (request: FastifyRequest): { userId: number; guildId: number } => {
  if (request.user.principalType === 'DEPUTY') {
    throw new AppError('FORBIDDEN', '부주 계정은 부주 계정을 관리할 수 없습니다.', 403);
  }
  const userId = Number(request.user.sub);
  const guildId = request.user.guildId;
  if (!Number.isSafeInteger(userId) || userId < 1 || !Number.isSafeInteger(guildId) || guildId < 1) {
    throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
  }
  return { userId, guildId };
};

const deputyIdentity = (request: FastifyRequest): { deputyId: number; guildId: number } => {
  const deputyId = request.user.principalType === 'DEPUTY' ? request.user.principalId : null;
  const guildId = request.user.guildId;
  if (!deputyId || !Number.isSafeInteger(guildId) || guildId < 1) {
    throw new AppError('UNAUTHORIZED', '부주 계정 인증이 필요합니다.', 401);
  }
  return { deputyId, guildId };
};

export const registerDeputyAccountRoutes = async (app: FastifyInstance): Promise<void> => {
  const service = new DeputyAccountsService(new DeputyAccountsRepository(app.db));

  app.post(
    `${API_PREFIX}/deputy-auth/login`,
    {
      schema: {
        tags: ['deputy-accounts'],
        body: deputyLoginBodySchema,
        response: { 200: deputyLoginResponseSchema },
      },
    },
    async (request, reply) => {
      const body = request.body as DeputyLoginBody;
      const account = await service.login(body.username, body.password);
      const activeCharacter = service.getActiveCharacter(account.id, account.guildId);
      const token = app.jwt.sign({
        sub: String(account.id),
        guildId: account.guildId,
        role: 'MEMBER',
        username: account.username,
        nickname: account.nickname,
        principalType: 'DEPUTY',
        tokenVersion: account.tokenVersion,
      });
      return reply.send(
        success({
          token,
          deputyId: account.id,
          guildId: account.guildId,
          username: account.username,
          nickname: account.nickname,
          activeCharacter,
          permissions: DEPUTY_PERMISSIONS,
        }),
      );
    },
  );

  app.get(
    `${API_PREFIX}/deputy-accounts`,
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['deputy-accounts'],
        response: { 200: deputyAccountListResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = accountIdentity(request);
      return reply.send(success(service.listAccounts(identity.userId, identity.guildId)));
    },
  );

  app.post(
    `${API_PREFIX}/deputy-accounts`,
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['deputy-accounts'],
        body: deputyCreateBodySchema,
        response: { 201: deputyCreatedResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = accountIdentity(request);
      const body = request.body as DeputyCreateBody;
      const id = await service.createAccount(identity.userId, identity.guildId, body);
      return reply.code(201).send(success({ id }));
    },
  );

  app.put(
    `${API_PREFIX}/deputy-accounts/:id/password`,
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['deputy-accounts'],
        params: deputyAccountParamsSchema,
        body: deputyPasswordBodySchema,
        response: { 204: noContentResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = accountIdentity(request);
      const params = request.params as DeputyAccountParams;
      const body = request.body as DeputyPasswordBody;
      await service.updatePassword(identity.userId, identity.guildId, params.id, body.password);
      return reply.code(204).send();
    },
  );

  app.put(
    `${API_PREFIX}/deputy-accounts/:id/active`,
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['deputy-accounts'],
        params: deputyAccountParamsSchema,
        body: deputyActiveBodySchema,
        response: { 204: noContentResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = accountIdentity(request);
      const params = request.params as DeputyAccountParams;
      const body = request.body as DeputyActiveBody;
      service.setActive(identity.userId, identity.guildId, params.id, body.isActive);
      return reply.code(204).send();
    },
  );

  app.get(
    `${API_PREFIX}/deputy/characters`,
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['deputy-accounts'],
        response: { 200: deputyCharactersResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = deputyIdentity(request);
      return reply.send(success(service.getCharacters(identity.guildId)));
    },
  );

  app.get(
    `${API_PREFIX}/deputy/active-character`,
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['deputy-accounts'],
        response: { 200: deputyCharacterResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = deputyIdentity(request);
      return reply.send(success(service.getActiveCharacter(identity.deputyId, identity.guildId)));
    },
  );

  app.put(
    `${API_PREFIX}/deputy/active-character`,
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['deputy-accounts'],
        body: deputySelectCharacterBodySchema,
        response: { 200: deputyCharacterResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = deputyIdentity(request);
      const body = request.body as DeputySelectCharacterBody;
      const character = service.selectActiveCharacter(
        identity.deputyId,
        identity.guildId,
        body.characterKey,
      );
      return reply.send(success(character));
    },
  );
};
