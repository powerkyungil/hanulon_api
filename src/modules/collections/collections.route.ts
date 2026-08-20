import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { API_PREFIX } from '../../config/constants';
import { AppError } from '../../shared/errors/app-error';
import { success } from '../../shared/http/response';
import { CollectionsRepository } from './collections.repository';
import {
  collectionBodySchema,
  collectionParamsSchema,
  completionBodySchema,
  completionLogQuerySchema,
  exclusionBodySchema,
  legacyCollectionListResponseSchema,
  legacyCompletionListResponseSchema,
  legacyCreatedResponseSchema,
  legacyExclusionListResponseSchema,
  legacyMutationStatusResponseSchema,
  legacySuccessResponseSchema,
  noContentResponseSchema,
  v1CollectionListResponseSchema,
  v1CollectionResponseSchema,
  v1CompletionListResponseSchema,
  v1CompletionLogListResponseSchema,
  v1CompletionMutationResponseSchema,
  v1ExclusionListResponseSchema,
  v1ExclusionMutationResponseSchema,
  type CollectionBody,
  type CollectionParams,
  type CompletionBody,
  type CompletionLogQuery,
  type ExclusionBody,
} from './collections.schema';
import { CollectionsService } from './collections.service';
import type { ItemCollection } from './collections.types';

type ResponseStyle = 'v1' | 'legacy';

interface CollectionRouteConfig {
  responseStyle: ResponseStyle;
}

const routeConfig = (responseStyle: ResponseStyle): CollectionRouteConfig => ({ responseStyle });

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

const toLegacyCollection = (collection: ItemCollection) => ({
  id: collection.id,
  name: collection.name,
  items: collection.items.map((item) => ({
    id: item.id,
    part: item.part,
    enchantment: item.enchantment,
  })),
});

const toV1Collection = (collection: ItemCollection) => ({
  id: collection.id,
  name: collection.name,
  items: collection.items.map((item) => ({
    id: item.id,
    part: item.part,
    enchantment: item.enchantment,
    sortOrder: item.sortOrder,
  })),
});

export const registerCollectionRoutes = async (app: FastifyInstance): Promise<void> => {
  const service = new CollectionsService(new CollectionsRepository(app.db));

  const registerDefinitionRoutes = (baseUrl: string, responseStyle: ResponseStyle): void => {
    app.get(
      baseUrl,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['collections'],
          response: {
            200:
              responseStyle === 'v1'
                ? v1CollectionListResponseSchema
                : legacyCollectionListResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const collections = service.getCollections(identity.userId, identity.guildId);
        return reply.send(
          responseStyle === 'v1'
            ? success(collections.map(toV1Collection))
            : collections.map(toLegacyCollection),
        );
      },
    );

    app.post(
      baseUrl,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['collections'],
          body: collectionBodySchema,
          response: {
            [responseStyle === 'v1' ? 201 : 200]:
              responseStyle === 'v1' ? v1CollectionResponseSchema : legacyCreatedResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const collection = service.createCollection(
          identity.userId,
          identity.guildId,
          request.body as CollectionBody,
        );
        return responseStyle === 'v1'
          ? reply.code(201).send(success(toV1Collection(collection)))
          : reply.send({ success: true, id: collection.id });
      },
    );

    app.put(
      `${baseUrl}/:id`,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['collections'],
          params: collectionParamsSchema,
          body: collectionBodySchema,
          response: {
            200: responseStyle === 'v1' ? v1CollectionResponseSchema : legacySuccessResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const params = request.params as CollectionParams;
        const collection = service.updateCollection(
          identity.userId,
          identity.guildId,
          params.id,
          request.body as CollectionBody,
        );
        return reply.send(
          responseStyle === 'v1' ? success(toV1Collection(collection)) : { success: true },
        );
      },
    );

    app.delete(
      `${baseUrl}/:id`,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['collections'],
          params: collectionParamsSchema,
          response: {
            [responseStyle === 'v1' ? 204 : 200]:
              responseStyle === 'v1' ? noContentResponseSchema : legacySuccessResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const params = request.params as CollectionParams;
        service.deleteCollection(identity.userId, identity.guildId, params.id);
        return responseStyle === 'v1' ? reply.code(204).send() : reply.send({ success: true });
      },
    );
  };

  const registerCompletionRoutes = (
    listUrl: string,
    mutationUrl: string,
    responseStyle: ResponseStyle,
  ): void => {
    app.get(
      listUrl,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['collections'],
          response: {
            200:
              responseStyle === 'v1'
                ? v1CompletionListResponseSchema
                : legacyCompletionListResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const completions = service.getCompletions(identity.userId, identity.guildId);
        return reply.send(
          responseStyle === 'v1'
            ? success(completions)
            : completions.map((completion) => ({
                user_id: completion.userId,
                collection_item_id: completion.collectionItemId,
              })),
        );
      },
    );

    const options = {
      config: routeConfig(responseStyle),
      preHandler: app.authenticate,
      schema: {
        tags: ['collections'],
        body: completionBodySchema,
        response: {
          200:
            responseStyle === 'v1'
              ? v1CompletionMutationResponseSchema
              : legacyMutationStatusResponseSchema,
        },
      },
    };
    const handler = async (request: FastifyRequest, reply: FastifyReply) => {
      const identity = identityFromRequest(request);
      const body = request.body as CompletionBody;
      const status = service.setCompletion(
        identity.userId,
        identity.guildId,
        body.userId,
        body.collectionItemId,
        body.completed,
      );
      return reply.send(
        responseStyle === 'v1' ? success({ status, completed: body.completed }) : { status },
      );
    };
    if (responseStyle === 'v1') {
      app.put(mutationUrl, options, handler);
    } else {
      app.post(mutationUrl, options, handler);
    }
  };

  const registerExclusionRoutes = (
    listUrl: string,
    mutationUrl: string,
    responseStyle: ResponseStyle,
  ): void => {
    app.get(
      listUrl,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['collections'],
          response: {
            200:
              responseStyle === 'v1'
                ? v1ExclusionListResponseSchema
                : legacyExclusionListResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const ids = service.getExcludedMemberIds(identity.userId, identity.guildId);
        return reply.send(responseStyle === 'v1' ? success(ids) : ids);
      },
    );

    app.post(
      mutationUrl,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['collections'],
          body: exclusionBodySchema,
          response: {
            200:
              responseStyle === 'v1'
                ? v1ExclusionMutationResponseSchema
                : legacyMutationStatusResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const body = request.body as ExclusionBody;
        const status = service.toggleExcluded(identity.userId, identity.guildId, body.userId);
        return reply.send(responseStyle === 'v1' ? success({ status }) : { status });
      },
    );
  };

  registerDefinitionRoutes(`${API_PREFIX}/collections`, 'v1');
  registerCompletionRoutes(
    `${API_PREFIX}/collection-completions`,
    `${API_PREFIX}/collection-completions`,
    'v1',
  );
  registerExclusionRoutes(
    `${API_PREFIX}/collection-exclusions`,
    `${API_PREFIX}/collection-exclusions/toggle`,
    'v1',
  );

  app.get(
    `${API_PREFIX}/collection-completion-logs`,
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['collections'],
        querystring: completionLogQuerySchema,
        response: { 200: v1CompletionLogListResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = identityFromRequest(request);
      const query = request.query as CompletionLogQuery;
      const limit = query.limit ?? 30;
      const page = service.getCompletionLogs(
        identity.userId,
        identity.guildId,
        query.cursor,
        limit,
        query.targetUserId,
      );
      return reply.send({
        data: page.items,
        meta: { limit, nextCursor: page.nextCursor },
      });
    },
  );

  registerDefinitionRoutes('/api/v2/collections', 'legacy');
  registerCompletionRoutes('/api/v2/user-collections', '/api/v2/user-collections/toggle', 'legacy');
  registerDefinitionRoutes('/api/collections', 'legacy');
  registerCompletionRoutes('/api/user-collections', '/api/user-collections/toggle', 'legacy');
  registerExclusionRoutes('/api/excluded-members', '/api/excluded-members/toggle', 'legacy');
};
