import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { AppConfig } from '../../config/env';
import { API_PREFIX } from '../../config/constants';
import {
  ClovaOcrClient,
  type OcrImageContentType,
} from '../../infrastructure/ocr/clova-ocr.client';
import { AppError } from '../../shared/errors/app-error';
import { success } from '../../shared/http/response';
import { OcrRepository } from './ocr.repository';
import { ocrHeadersSchema, ocrTemplateListSchema, type OcrHeaders } from './ocr.schema';
import { OcrService } from './ocr.service';

type ResponseStyle = 'v1' | 'legacy';

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

export const registerOcrRoutes = async (app: FastifyInstance, config: AppConfig): Promise<void> => {
  app.addContentTypeParser(
    ['image/jpeg', 'image/png'],
    { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 },
    (_request, body, done) => done(null, body),
  );

  const service = new OcrService(
    new OcrRepository(app.db),
    new ClovaOcrClient(config.ocrInvokeUrl, config.ocrSecret),
    Boolean(config.ocrInvokeUrl && config.ocrSecret),
    config.ocrTemplates,
  );

  const registerRoutes = (baseUrl: string, style: ResponseStyle): void => {
    app.get(
      `${baseUrl}/templates`,
      {
        config: { responseStyle: style },
        preHandler: app.authenticate,
        schema: {
          tags: ['ocr'],
          response: {
            200:
              style === 'v1' ? Type.Object({ data: ocrTemplateListSchema }) : ocrTemplateListSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const body = { templates: service.getTemplates(identity.userId, identity.guildId) };
        return reply.send(style === 'v1' ? success(body) : body);
      },
    );

    app.post(
      `${baseUrl}/boss-schedule`,
      {
        config: { responseStyle: style },
        preHandler: app.authenticate,
        schema: {
          tags: ['ocr'],
          headers: ocrHeadersSchema,
          body: Type.Any(),
          response: { 200: Type.Any() },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const contentType =
          request.headers['content-type'] === 'image/png' ? 'image/png' : 'image/jpeg';
        const templateId = Number((request.headers as OcrHeaders)['x-ocr-template-id']);
        const result = await service.analyze(
          identity.userId,
          identity.guildId,
          request.body as Buffer,
          contentType as OcrImageContentType,
          templateId,
        );
        return reply.send(style === 'v1' ? success(result) : result);
      },
    );
  };

  registerRoutes(`${API_PREFIX}/ocr`, 'v1');
  registerRoutes('/api/ocr', 'legacy');
};
