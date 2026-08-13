import type { FastifyInstance, FastifyRequest } from 'fastify';

import { API_PREFIX } from '../../config/constants';
import { AppError } from '../../shared/errors/app-error';
import { success } from '../../shared/http/response';
import { SupportRepository } from './support.repository';
import {
  legacyCreatedIdResponseSchema,
  legacySuccessResponseSchema,
  legacySupportListResponseSchema,
  noContentResponseSchema,
  supportApplicationBodySchema,
  supportApplicationParamsSchema,
  supportRequestBodySchema,
  supportRequestParamsSchema,
  supportStatusBodySchema,
  v1CreatedIdResponseSchema,
  v1SupportListResponseSchema,
  type SupportApplicationBody,
  type SupportApplicationParams,
  type SupportRequestBody,
  type SupportRequestParams,
  type SupportStatusBody,
} from './support.schema';
import { SupportService } from './support.service';
import type { SupportRequest } from './support.types';

type ResponseStyle = 'v1' | 'legacy';

interface SupportRouteConfig {
  responseStyle: ResponseStyle;
}

const routeConfig = (responseStyle: ResponseStyle): SupportRouteConfig => ({ responseStyle });

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

const toV1Request = (request: SupportRequest) => ({
  id: request.id,
  requesterId: request.requesterId,
  requestedTime: request.requestedTime,
  memo: request.memo,
  status: request.status,
  selectedApplicationId: request.selectedApplicationId,
  createdAt: request.createdAt,
  updatedAt: request.updatedAt,
  nickname: request.nickname,
  occupation: request.occupation,
  mainClass: request.mainClass,
  combatPower: request.combatPower,
  applications: request.applications.map((application) => ({
    id: application.id,
    requestId: application.requestId,
    applicantId: application.applicantId,
    memo: application.memo,
    status: application.status,
    createdAt: application.createdAt,
    nickname: application.nickname,
    occupation: application.occupation,
    mainClass: application.mainClass,
    combatPower: application.combatPower,
  })),
});

const toLegacyRequest = (request: SupportRequest) => ({
  ...toV1Request(request),
  createdAt: new Date(request.createdAt).toISOString(),
  updatedAt: new Date(request.updatedAt).toISOString(),
  applications: request.applications.map((application) => ({
    id: application.id,
    requestId: application.requestId,
    applicantId: application.applicantId,
    memo: application.memo,
    status: application.status,
    createdAt: new Date(application.createdAt).toISOString(),
    nickname: application.nickname,
    occupation: application.occupation,
    mainClass: application.mainClass,
    combatPower: application.combatPower,
  })),
});

export const registerSupportRoutes = async (app: FastifyInstance): Promise<void> => {
  const service = new SupportService(new SupportRepository(app.db));

  const registerRoutes = (baseUrl: string, responseStyle: ResponseStyle): void => {
    const mutationResponse = {
      [responseStyle === 'v1' ? 204 : 200]:
        responseStyle === 'v1' ? noContentResponseSchema : legacySuccessResponseSchema,
    };

    app.get(
      baseUrl,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['support'],
          response: {
            200:
              responseStyle === 'v1'
                ? v1SupportListResponseSchema
                : legacySupportListResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const requests = service.getRequests(identity.userId, identity.guildId);
        return reply.send(
          responseStyle === 'v1'
            ? success(requests.map(toV1Request))
            : requests.map(toLegacyRequest),
        );
      },
    );

    app.post(
      baseUrl,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['support'],
          body: supportRequestBodySchema,
          response: {
            [responseStyle === 'v1' ? 201 : 200]:
              responseStyle === 'v1' ? v1CreatedIdResponseSchema : legacyCreatedIdResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const body = request.body as SupportRequestBody;
        const id = service.createRequest(identity.userId, identity.guildId, {
          requestedTime: body.requestedTime,
          memo: body.memo ?? '',
        });
        return responseStyle === 'v1'
          ? reply.code(201).send(success({ id }))
          : reply.send({ success: true, id });
      },
    );

    app.put(
      `${baseUrl}/:id/status`,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['support'],
          params: supportRequestParamsSchema,
          body: supportStatusBodySchema,
          response: mutationResponse,
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const params = request.params as SupportRequestParams;
        const body = request.body as SupportStatusBody;
        service.updateStatus(identity.userId, identity.guildId, params.id, body.status);
        return responseStyle === 'v1' ? reply.code(204).send() : reply.send({ success: true });
      },
    );

    app.delete(
      `${baseUrl}/:id`,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['support'],
          params: supportRequestParamsSchema,
          response: mutationResponse,
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const params = request.params as SupportRequestParams;
        service.deleteRequest(identity.userId, identity.guildId, params.id);
        return responseStyle === 'v1' ? reply.code(204).send() : reply.send({ success: true });
      },
    );

    app.post(
      `${baseUrl}/:id/applications`,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['support'],
          params: supportRequestParamsSchema,
          body: supportApplicationBodySchema,
          response: {
            [responseStyle === 'v1' ? 201 : 200]:
              responseStyle === 'v1' ? v1CreatedIdResponseSchema : legacyCreatedIdResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const params = request.params as SupportRequestParams;
        const body = request.body as SupportApplicationBody;
        const id = service.createApplication(
          identity.userId,
          identity.guildId,
          params.id,
          body.memo ?? '',
        );
        return responseStyle === 'v1'
          ? reply.code(201).send(success({ id }))
          : reply.send({ success: true, id });
      },
    );

    app.delete(
      `${baseUrl}/:requestId/applications/:applicationId`,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['support'],
          params: supportApplicationParamsSchema,
          response: mutationResponse,
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const params = request.params as SupportApplicationParams;
        service.cancelApplication(
          identity.userId,
          identity.guildId,
          params.requestId,
          params.applicationId,
        );
        return responseStyle === 'v1' ? reply.code(204).send() : reply.send({ success: true });
      },
    );

    app.post(
      `${baseUrl}/:requestId/select/:applicationId`,
      {
        config: routeConfig(responseStyle),
        preHandler: app.authenticate,
        schema: {
          tags: ['support'],
          params: supportApplicationParamsSchema,
          response: mutationResponse,
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const params = request.params as SupportApplicationParams;
        service.selectApplication(
          identity.userId,
          identity.guildId,
          params.requestId,
          params.applicationId,
        );
        return responseStyle === 'v1' ? reply.code(204).send() : reply.send({ success: true });
      },
    );
  };

  registerRoutes(`${API_PREFIX}/support-requests`, 'v1');
  registerRoutes('/api/support-requests', 'legacy');
};
