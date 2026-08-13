import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { API_PREFIX } from '../../config/constants';
import { AppError } from '../../shared/errors/app-error';
import { success } from '../../shared/http/response';
import { ContentGroupsRepository } from './content-groups.repository';
import {
  groupMembersBodySchema,
  groupNameBodySchema,
  groupParamsSchema,
  legacyGroupListResponseSchema,
  legacyGroupResponseSchema,
  noContentResponseSchema,
  v1GroupListResponseSchema,
  v1GroupResponseSchema,
  type GroupMembersBody,
  type GroupNameBody,
  type GroupParams,
} from './content-groups.schema';
import { ContentGroupsService } from './content-groups.service';

type ResponseStyle = 'v1' | 'legacy';

interface ContentGroupRouteConfig {
  responseStyle: ResponseStyle;
}

const routeConfig = (responseStyle: ResponseStyle): ContentGroupRouteConfig => ({
  responseStyle,
});

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

export const registerContentGroupRoutes = async (app: FastifyInstance): Promise<void> => {
  const service = new ContentGroupsService(new ContentGroupsRepository(app.db));

  const registerRoutes = (baseUrl: string, responseStyle: ResponseStyle): void => {
    app.get(
      baseUrl,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['content-groups'],
          response: {
            200: responseStyle === 'v1' ? v1GroupListResponseSchema : legacyGroupListResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const groups = service.getGroups(identity.userId, identity.guildId).map((group) => ({
          id: group.id,
          name: group.name,
          memberIds: group.memberIds,
        }));
        return reply.send(responseStyle === 'v1' ? success(groups) : groups);
      },
    );

    app.post(
      baseUrl,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['content-groups'],
          body: groupNameBodySchema,
          response: {
            [responseStyle === 'v1' ? 201 : 200]:
              responseStyle === 'v1' ? v1GroupResponseSchema : legacyGroupResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const body = request.body as GroupNameBody;
        const group = service.createGroup(identity.userId, identity.guildId, body.name);
        const response = { id: group.id, name: group.name, memberIds: group.memberIds };
        return responseStyle === 'v1'
          ? reply.code(201).send(success(response))
          : reply.send(response);
      },
    );

    app.put(
      `${baseUrl}/:id`,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['content-groups'],
          params: groupParamsSchema,
          body: groupNameBodySchema,
          response: { 204: noContentResponseSchema },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const params = request.params as GroupParams;
        const body = request.body as GroupNameBody;
        service.renameGroup(identity.userId, identity.guildId, params.id, body.name);
        return reply.code(204).send();
      },
    );

    app.delete(
      `${baseUrl}/:id`,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['content-groups'],
          params: groupParamsSchema,
          response: { 204: noContentResponseSchema },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const params = request.params as GroupParams;
        service.deleteGroup(identity.userId, identity.guildId, params.id);
        return reply.code(204).send();
      },
    );

    const memberOptions = {
      config: routeConfig(responseStyle),
      preHandler: app.authenticate,
      schema: {
        tags: ['content-groups'],
        params: groupParamsSchema,
        body: groupMembersBodySchema,
        response: { 204: noContentResponseSchema },
      },
    };
    const memberHandler = async (request: FastifyRequest, reply: FastifyReply) => {
      const identity = identityFromRequest(request);
      const params = request.params as GroupParams;
      const body = request.body as GroupMembersBody;
      service.replaceMembers(identity.userId, identity.guildId, params.id, body.userIds);
      return reply.code(204).send();
    };

    if (responseStyle === 'v1') {
      app.put(`${baseUrl}/:id/members`, memberOptions, memberHandler);
    } else {
      app.post(`${baseUrl}/:id/members`, memberOptions, memberHandler);
    }
  };

  registerRoutes(`${API_PREFIX}/content-groups`, 'v1');
  registerRoutes('/api/groups', 'legacy');
};
