import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { failure, legacyFailure } from '../shared/http/response';
import { AppError } from '../shared/errors/app-error';

const isLegacyRoute = (request: FastifyRequest): boolean => {
  const config = request.routeOptions.config as { responseStyle?: unknown } | undefined;
  return config?.responseStyle === 'legacy';
};

const isValidationError = (error: { code?: string }): boolean =>
  error.code === 'FST_ERR_VALIDATION';

export const registerErrorHandler = (app: FastifyInstance): void => {
  app.setErrorHandler(
    (
      error: Error & { code?: string; statusCode?: number; validation?: unknown[] },
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      if (error instanceof AppError) {
        const response = isLegacyRoute(request)
          ? legacyFailure(error.code, error.message, request.id, error.details)
          : failure(error.code, error.message, request.id, error.details);
        reply.status(error.statusCode).send(response);
        return;
      }

      if (isValidationError(error)) {
        const response = isLegacyRoute(request)
          ? legacyFailure('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다.', request.id, {
              validation: error.validation ?? null,
            })
          : failure('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다.', request.id, {
              validation: error.validation ?? null,
            });
        reply.status(400).send(response);
        return;
      }

      const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
      request.log.error({ err: error, requestId: request.id }, 'Unhandled request error');
      const response = isLegacyRoute(request)
        ? legacyFailure('INTERNAL_SERVER_ERROR', '서버 오류가 발생했습니다.', request.id)
        : failure('INTERNAL_SERVER_ERROR', '서버 오류가 발생했습니다.', request.id);
      reply.status(statusCode).send(response);
    },
  );
};
