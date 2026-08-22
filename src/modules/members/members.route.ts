import type { FastifyInstance, FastifyRequest } from 'fastify';

import { API_PREFIX } from '../../config/constants';
import { AppError } from '../../shared/errors/app-error';
import { success } from '../../shared/http/response';
import { MembersRepository } from './members.repository';
import {
  accountDeletionBodySchema,
  legacyMasterTransferBodySchema,
  legacyMemberListResponseSchema,
  legacyProfileResponseSchema,
  legacyProfileUpdateBodySchema,
  masterTransferBodySchema,
  memberIdParamsSchema,
  memberListResponseSchema,
  noContentResponseSchema,
  profileUpdateBodySchema,
  roleUpdateBodySchema,
  v1ProfileResponseSchema,
  type LegacyMasterTransferBody,
  type AccountDeletionBody,
  type LegacyProfileUpdateBody,
  type MasterTransferBody,
  type MemberIdParams,
  type ProfileUpdateBody,
  type RoleUpdateBody,
} from './members.schema';
import { MembersService } from './members.service';
import type { ProfileUpdateInput, UserProfile } from './members.types';

type ResponseStyle = 'v1' | 'legacy';

interface MemberRouteConfig {
  responseStyle: ResponseStyle;
}

const routeConfig = (responseStyle: ResponseStyle): MemberRouteConfig => ({ responseStyle });

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

const toCamelProfile = (profile: UserProfile) => ({
  id: profile.id,
  username: profile.username,
  role: profile.role,
  nickname: profile.nickname,
  occupation: profile.occupation,
  mainClass: profile.mainClass,
  combatPower: profile.combatPower,
  equipment: profile.equipment,
  skills: profile.skills,
  maxCritRate: profile.maxCritRate,
  maxCritResist: profile.maxCritResist,
  statusEffectAcc: profile.statusEffectAcc,
  alternateCharacters: profile.alternateCharacters,
});

const toLegacyProfile = (profile: UserProfile) => ({
  id: profile.id,
  username: profile.username,
  role: profile.role,
  nickname: profile.nickname,
  occupation: profile.occupation,
  main_class: profile.mainClass,
  combat_power: profile.combatPower,
  equipment: profile.equipment,
  skills: profile.skills,
  max_crit_rate: profile.maxCritRate,
  max_crit_resist: profile.maxCritResist,
  status_effect_acc: profile.statusEffectAcc,
  alternate_characters: profile.alternateCharacters.map((alternate) => ({
    id: alternate.id,
    character_name: alternate.characterName,
    main_class: alternate.mainClass,
  })),
});

const normalizeCamelInput = (body: ProfileUpdateBody): ProfileUpdateInput => ({
  nickname: body.nickname.trim(),
  occupation: body.occupation.trim(),
  mainClass: body.mainClass.trim(),
  combatPower: body.combatPower,
  equipment: body.equipment,
  skills: body.skills,
  maxCritRate: body.maxCritRate,
  maxCritResist: body.maxCritResist,
  statusEffectAcc: body.statusEffectAcc,
  alternateCharacters: body.alternateCharacters.map((alternate) => ({
    characterName: alternate.characterName.trim(),
    mainClass: alternate.mainClass.trim(),
  })),
  password: body.password,
});

const normalizeLegacyInput = (body: LegacyProfileUpdateBody): ProfileUpdateInput => ({
  nickname: body.nickname.trim(),
  occupation: body.occupation.trim(),
  mainClass: body.main_class.trim(),
  combatPower: body.combat_power,
  equipment: body.equipment,
  skills: body.skills,
  maxCritRate: body.max_crit_rate,
  maxCritResist: body.max_crit_resist,
  statusEffectAcc: body.status_effect_acc,
  alternateCharacters: body.alternate_characters.map((alternate) => ({
    characterName: alternate.character_name.trim(),
    mainClass: alternate.main_class.trim(),
  })),
  password: body.password,
});

export const registerMemberRoutes = async (app: FastifyInstance): Promise<void> => {
  const service = new MembersService(new MembersRepository(app.db));

  const registerGetRoute = (url: string, responseStyle: ResponseStyle): void => {
    app.get(
      url,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['members'],
          response: {
            200: responseStyle === 'v1' ? v1ProfileResponseSchema : legacyProfileResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const profile = service.getMe(identity.userId, identity.guildId);
        return reply.send(
          responseStyle === 'v1' ? success(toCamelProfile(profile)) : toLegacyProfile(profile),
        );
      },
    );
  };

  const registerPutRoute = (url: string, responseStyle: ResponseStyle): void => {
    app.put(
      url,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          body: responseStyle === 'v1' ? profileUpdateBodySchema : legacyProfileUpdateBodySchema,
          response: { 204: noContentResponseSchema },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const input =
          responseStyle === 'v1'
            ? normalizeCamelInput(request.body as ProfileUpdateBody)
            : normalizeLegacyInput(request.body as LegacyProfileUpdateBody);
        await service.updateMe(identity.userId, identity.guildId, input);
        return reply.code(204).send();
      },
    );
  };

  const registerDeleteMeRoute = (url: string, responseStyle: ResponseStyle): void => {
    app.delete(
      url,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['members'],
          body: accountDeletionBodySchema,
          response: { 204: noContentResponseSchema },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const body = request.body as AccountDeletionBody;
        await service.deleteMe(identity.userId, identity.guildId, body.password);
        return reply.code(204).send();
      },
    );
  };

  const registerListRoute = (url: string, responseStyle: ResponseStyle): void => {
    app.get(
      url,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['members'],
          response: {
            200: responseStyle === 'v1' ? memberListResponseSchema : legacyMemberListResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const members = service.getMembers(identity.userId, identity.guildId);
        return reply.send(
          responseStyle === 'v1'
            ? success(members.map(toCamelProfile))
            : members.map(toLegacyProfile),
        );
      },
    );
  };

  const registerRoleRoute = (url: string, responseStyle: ResponseStyle): void => {
    app.put(
      url,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          params: memberIdParamsSchema,
          body: roleUpdateBodySchema,
          response: { 204: noContentResponseSchema },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const params = request.params as MemberIdParams;
        const body = request.body as RoleUpdateBody;
        service.changeRole(identity.userId, identity.guildId, params.id, body.role);
        return reply.code(204).send();
      },
    );
  };

  const registerTransferRoute = (url: string, responseStyle: ResponseStyle): void => {
    app.put(
      url,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          body: responseStyle === 'v1' ? masterTransferBodySchema : legacyMasterTransferBodySchema,
          response: { 204: noContentResponseSchema },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const targetUserId =
          responseStyle === 'v1'
            ? (request.body as MasterTransferBody).targetUserId
            : (request.body as LegacyMasterTransferBody).target_user_id;
        service.transferMaster(identity.userId, identity.guildId, targetUserId);
        return reply.code(204).send();
      },
    );
  };

  const registerPasswordResetRoute = (url: string, responseStyle: ResponseStyle): void => {
    app.put(
      url,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          params: memberIdParamsSchema,
          response: { 204: noContentResponseSchema },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const params = request.params as MemberIdParams;
        await service.resetPassword(identity.userId, identity.guildId, params.id);
        return reply.code(204).send();
      },
    );
  };

  const registerRemoveRoute = (url: string, responseStyle: ResponseStyle): void => {
    app.delete(
      url,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          params: memberIdParamsSchema,
          response: { 204: noContentResponseSchema },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const params = request.params as MemberIdParams;
        service.removeMember(identity.userId, identity.guildId, params.id);
        return reply.code(204).send();
      },
    );
  };

  registerGetRoute(`${API_PREFIX}/auth/me`, 'v1');
  registerPutRoute(`${API_PREFIX}/auth/me`, 'v1');
  registerDeleteMeRoute(`${API_PREFIX}/auth/me`, 'v1');
  registerListRoute(`${API_PREFIX}/members`, 'v1');
  registerRoleRoute(`${API_PREFIX}/members/:id/role`, 'v1');
  registerTransferRoute(`${API_PREFIX}/guild/master`, 'v1');
  registerPasswordResetRoute(`${API_PREFIX}/members/:id/password-reset`, 'v1');
  registerRemoveRoute(`${API_PREFIX}/members/:id`, 'v1');

  // Flutter's current ApiPaths use this legacy path and snake_case DTOs.
  registerGetRoute('/api/users/me', 'legacy');
  registerPutRoute('/api/users/me', 'legacy');
  registerDeleteMeRoute('/api/users/me', 'legacy');
  registerListRoute('/api/users', 'legacy');
  registerRoleRoute('/api/admin/users/:id/role', 'legacy');
  registerTransferRoute('/api/admin/guild/master', 'legacy');
  registerPasswordResetRoute('/api/admin/users/:id/reset-password', 'legacy');
  registerRemoveRoute('/api/admin/users/:id', 'legacy');
};
