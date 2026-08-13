import type { FastifyInstance, FastifyRequest } from 'fastify';

import { API_PREFIX } from '../../config/constants';
import { AppError } from '../../shared/errors/app-error';
import { success } from '../../shared/http/response';
import { NoticesRepository } from './notices.repository';
import {
  bossControlUpdateBodySchema,
  legacyBossControlsResponseSchema,
  legacyCreatedResponseSchema,
  legacyNoticeArticleListResponseSchema,
  legacySuccessResponseSchema,
  noContentResponseSchema,
  noticeArticleBodySchema,
  noticeArticleParamsSchema,
  noticeRuleOrderBodySchema,
  v1BossControlsResponseSchema,
  v1BossControlUpdateResponseSchema,
  v1NoticeArticleListResponseSchema,
  v1NoticeArticleResponseSchema,
  type BossControlUpdateBody,
  type NoticeArticleBody,
  type NoticeArticleParams,
  type NoticeRuleOrderBody,
} from './notices.schema';
import { NoticesService } from './notices.service';
import type { NoticeArticle, NoticeArticleType } from './notices.types';

type ResponseStyle = 'v1' | 'legacy';

interface NoticeRouteConfig {
  responseStyle: ResponseStyle;
}

const routeConfig = (responseStyle: ResponseStyle): NoticeRouteConfig => ({ responseStyle });

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

const toV1Article = (article: NoticeArticle) => ({
  id: article.id,
  title: article.title,
  content: article.content,
  color: article.color,
  sortOrder: article.sortOrder,
  updatedAt: article.updatedAt,
});

const toLegacyArticle = (article: NoticeArticle) => ({
  id: article.id,
  title: article.title,
  content: article.content,
  color: article.color,
  sort_order: article.sortOrder,
  updated_at: new Date(article.updatedAt).toISOString(),
});

export const registerNoticeRoutes = async (app: FastifyInstance): Promise<void> => {
  const service = new NoticesService(new NoticesRepository(app.db));

  const registerArticleRoutes = (
    collectionUrl: string,
    type: NoticeArticleType,
    responseStyle: ResponseStyle,
  ): void => {
    app.get(
      collectionUrl,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['notices'],
          response: {
            200:
              responseStyle === 'v1'
                ? v1NoticeArticleListResponseSchema
                : legacyNoticeArticleListResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const articles = service.getArticles(identity.userId, identity.guildId, type);
        return reply.send(
          responseStyle === 'v1'
            ? success(articles.map(toV1Article))
            : articles.map(toLegacyArticle),
        );
      },
    );

    app.post(
      collectionUrl,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['notices'],
          body: noticeArticleBodySchema,
          response: {
            [responseStyle === 'v1' ? 201 : 200]:
              responseStyle === 'v1' ? v1NoticeArticleResponseSchema : legacyCreatedResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const article = service.createArticle(
          identity.userId,
          identity.guildId,
          type,
          request.body as NoticeArticleBody,
        );
        return responseStyle === 'v1'
          ? reply.code(201).send(success(toV1Article(article)))
          : reply.send({ success: true, id: article.id });
      },
    );

    app.put(
      `${collectionUrl}/:id`,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['notices'],
          params: noticeArticleParamsSchema,
          body: noticeArticleBodySchema,
          response: {
            200:
              responseStyle === 'v1' ? v1NoticeArticleResponseSchema : legacySuccessResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const params = request.params as NoticeArticleParams;
        const article = service.updateArticle(
          identity.userId,
          identity.guildId,
          type,
          params.id,
          request.body as NoticeArticleBody,
        );
        return reply.send(
          responseStyle === 'v1' ? success(toV1Article(article)) : { success: true },
        );
      },
    );

    app.delete(
      `${collectionUrl}/:id`,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['notices'],
          params: noticeArticleParamsSchema,
          response: {
            [responseStyle === 'v1' ? 204 : 200]:
              responseStyle === 'v1' ? noContentResponseSchema : legacySuccessResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const params = request.params as NoticeArticleParams;
        service.deleteArticle(identity.userId, identity.guildId, type, params.id);
        return responseStyle === 'v1' ? reply.code(204).send() : reply.send({ success: true });
      },
    );
  };

  const registerRuleOrderRoute = (url: string, responseStyle: ResponseStyle): void => {
    app.put(
      url,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['notices'],
          body: noticeRuleOrderBodySchema,
          response: {
            [responseStyle === 'v1' ? 204 : 200]:
              responseStyle === 'v1' ? noContentResponseSchema : legacySuccessResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const body = request.body as NoticeRuleOrderBody;
        service.reorderRules(identity.userId, identity.guildId, body.ids);
        return responseStyle === 'v1' ? reply.code(204).send() : reply.send({ success: true });
      },
    );
  };

  const registerBossControlRoutes = (url: string, responseStyle: ResponseStyle): void => {
    app.get(
      url,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['notices'],
          response: {
            200:
              responseStyle === 'v1'
                ? v1BossControlsResponseSchema
                : legacyBossControlsResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const chapters = service.getBossControls(identity.userId, identity.guildId);
        const response = { chapters };
        return reply.send(responseStyle === 'v1' ? success(response) : response);
      },
    );

    app.put(
      url,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['notices'],
          body: bossControlUpdateBodySchema,
          response: {
            200:
              responseStyle === 'v1'
                ? v1BossControlUpdateResponseSchema
                : legacySuccessResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const updated = service.updateBossControl(
          identity.userId,
          identity.guildId,
          request.body as BossControlUpdateBody,
        );
        return reply.send(responseStyle === 'v1' ? success(updated) : { success: true });
      },
    );
  };

  registerArticleRoutes(`${API_PREFIX}/notices/rules`, 'RULE', 'v1');
  registerArticleRoutes(`${API_PREFIX}/notices/price-guides`, 'PRICE_GUIDE', 'v1');
  registerRuleOrderRoute(`${API_PREFIX}/notices/rules/order`, 'v1');
  registerBossControlRoutes(`${API_PREFIX}/notices/boss-controls`, 'v1');

  registerArticleRoutes('/api/notices/rules', 'RULE', 'legacy');
  registerArticleRoutes('/api/notices/price-guides', 'PRICE_GUIDE', 'legacy');
  registerRuleOrderRoute('/api/notices/rule-order', 'legacy');
  registerBossControlRoutes('/api/notices/boss-controls', 'legacy');
};
