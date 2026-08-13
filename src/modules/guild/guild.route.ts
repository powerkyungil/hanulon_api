import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { API_PREFIX } from '../../config/constants';
import { AppError } from '../../shared/errors/app-error';
import { success } from '../../shared/http/response';
import { GuildRepository } from './guild.repository';
import {
  guildSettingsUpdateBodySchema,
  inviteUpsertBodySchema,
  legacyGuildSettingsResponseSchema,
  legacyGuildSettingsUpdateBodySchema,
  legacyInviteListResponseSchema,
  legacyInviteResponseSchema,
  noContentResponseSchema,
  v1GuildSettingsResponseSchema,
  v1InviteListResponseSchema,
  v1InviteResponseSchema,
  type GuildSettingsUpdateBody,
  type InviteUpsertBody,
  type LegacyGuildSettingsUpdateBody,
} from './guild.schema';
import { GuildService } from './guild.service';
import type { GuildSettingsUpdate } from './guild.types';

type ResponseStyle = 'v1' | 'legacy';

interface GuildRouteConfig {
  responseStyle: ResponseStyle;
}

const routeConfig = (responseStyle: ResponseStyle): GuildRouteConfig => ({ responseStyle });

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

const normalizeV1Settings = (body: GuildSettingsUpdateBody): GuildSettingsUpdate => ({
  guildName: body.guildName,
  allowMemberCombatPowerEdit: body.allowMemberCombatPowerEdit,
});

const normalizeLegacySettings = (body: LegacyGuildSettingsUpdateBody): GuildSettingsUpdate => ({
  guildName: body.guild_name,
  allowMemberCombatPowerEdit: body.allow_member_combat_power_edit === 1,
});

export const registerGuildRoutes = async (app: FastifyInstance): Promise<void> => {
  const service = new GuildService(new GuildRepository(app.db));

  const registerGetSettingsRoute = (url: string, responseStyle: ResponseStyle): void => {
    app.get(
      url,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['guild'],
          response: {
            200:
              responseStyle === 'v1'
                ? v1GuildSettingsResponseSchema
                : legacyGuildSettingsResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const settings = service.getSettings(identity.userId, identity.guildId);
        return reply.send(
          responseStyle === 'v1'
            ? success({
                guildName: settings.guildName,
                allowMemberCombatPowerEdit: settings.allowMemberCombatPowerEdit,
              })
            : {
                guild_name: settings.guildName,
                allow_member_combat_power_edit: settings.allowMemberCombatPowerEdit ? 1 : 0,
              },
        );
      },
    );
  };

  const registerSaveSettingsRoute = (url: string, responseStyle: ResponseStyle): void => {
    const options = {
      config: routeConfig(responseStyle),
      preHandler: app.authenticate,
      schema: {
        body:
          responseStyle === 'v1'
            ? guildSettingsUpdateBodySchema
            : legacyGuildSettingsUpdateBodySchema,
        response: { 204: noContentResponseSchema },
      },
    };
    const handler = async (request: FastifyRequest, reply: FastifyReply) => {
      const identity = identityFromRequest(request);
      const input =
        responseStyle === 'v1'
          ? normalizeV1Settings(request.body as GuildSettingsUpdateBody)
          : normalizeLegacySettings(request.body as LegacyGuildSettingsUpdateBody);
      service.updateSettings(identity.userId, identity.guildId, input);
      return reply.code(204).send();
    };

    if (responseStyle === 'v1') {
      app.put(url, options, handler);
    } else {
      app.post(url, options, handler);
    }
  };

  const registerGetInvitesRoute = (url: string, responseStyle: ResponseStyle): void => {
    app.get(
      url,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['guild'],
          response: {
            200:
              responseStyle === 'v1' ? v1InviteListResponseSchema : legacyInviteListResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const invites = service.getInvites(identity.userId, identity.guildId);
        return reply.send(responseStyle === 'v1' ? success(invites) : { invites });
      },
    );
  };

  const registerSaveInviteRoute = (url: string, responseStyle: ResponseStyle): void => {
    app.post(
      url,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          body: inviteUpsertBodySchema,
          response: {
            200: responseStyle === 'v1' ? v1InviteResponseSchema : legacyInviteResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const body = request.body as InviteUpsertBody;
        const invite = service.saveInvite(
          identity.userId,
          identity.guildId,
          body.targetRole,
          body.customCode,
        );
        return reply.send(responseStyle === 'v1' ? success(invite) : invite);
      },
    );
  };

  registerGetSettingsRoute(`${API_PREFIX}/guild/settings`, 'v1');
  registerSaveSettingsRoute(`${API_PREFIX}/guild/settings`, 'v1');
  registerGetInvitesRoute(`${API_PREFIX}/auth/invites`, 'v1');
  registerSaveInviteRoute(`${API_PREFIX}/auth/invites`, 'v1');

  registerGetSettingsRoute('/api/settings', 'legacy');
  registerSaveSettingsRoute('/api/settings', 'legacy');
  registerGetInvitesRoute('/api/invites', 'legacy');
  registerSaveInviteRoute('/api/invites', 'legacy');
};
