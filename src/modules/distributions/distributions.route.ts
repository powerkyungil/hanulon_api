import type { FastifyInstance, FastifyRequest } from 'fastify';
import Decimal from 'decimal.js';

import { API_PREFIX } from '../../config/constants';
import { AppError } from '../../shared/errors/app-error';
import { success } from '../../shared/http/response';
import { DistributionsRepository } from './distributions.repository';
import {
  distributionAllianceRateTiersResponseSchema,
  distributionAllianceRateTiersUpdateSchema,
  distributionCreateSchema,
  distributionDetailResponseSchema,
  distributionListQuerySchema,
  distributionListResponseSchema,
  distributionMemberParamsSchema,
  distributionMemberUpdateSchema,
  distributionMembersBulkUpdateSchema,
  distributionParamsSchema,
  distributionReopenSchema,
  distributionUpdateSchema,
  noContentResponseSchema,
  type DistributionCreateBody,
  type DistributionAllianceRateTiersUpdateBody,
  type DistributionListQuery,
  type DistributionMemberParams,
  type DistributionMembersBulkUpdateBody,
  type DistributionMemberUpdateBody,
  type DistributionParams,
  type DistributionReopenBody,
  type DistributionUpdateBody,
} from './distributions.schema';
import { DistributionsService } from './distributions.service';
import type {
  DistributionCreateInput,
  DistributionMemberUpdateInput,
  DistributionPeriodUpdateInput,
} from './distributions.types';

const identityFromRequest = (request: FastifyRequest): { userId: number; guildId: number } => {
  const userId = Number(request.user.sub);
  const guildId = request.user.guildId;
  if (!Number.isSafeInteger(userId) || userId < 1 || !Number.isSafeInteger(guildId)) {
    throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
  }
  return { userId, guildId };
};

const decimalText = (value: string | number): string => String(value);
const decimalSum = (...values: Array<string | number | undefined>): string =>
  values.reduce((total, value) => total.plus(value ?? 0), new Decimal(0)).toString();

const memberInput = (body: DistributionMemberUpdateBody): DistributionMemberUpdateInput => ({
  ...(body.participationRate !== undefined
    ? {
        participationRate:
          body.participationRate === null ? null : decimalText(body.participationRate),
      }
    : {}),
  ...(body.allianceRate !== undefined ? { allianceRate: decimalText(body.allianceRate) } : {}),
  ...(body.payoutMultiplier !== undefined
    ? { payoutMultiplier: decimalText(body.payoutMultiplier) }
    : {}),
  ...(body.instantReviveCost !== undefined
    ? { instantReviveCost: decimalText(body.instantReviveCost) }
    : {}),
  ...(body.goldSupportCost !== undefined
    ? { goldSupportCost: decimalText(body.goldSupportCost) }
    : {}),
  ...(body.operationCost !== undefined ? { operationCost: decimalText(body.operationCost) } : {}),
  ...(body.otherSupportCost !== undefined
    ? { otherSupportCost: decimalText(body.otherSupportCost) }
    : {}),
  ...(body.note !== undefined ? { note: body.note } : {}),
});

export const registerDistributionRoutes = async (app: FastifyInstance): Promise<void> => {
  const service = new DistributionsService(new DistributionsRepository(app.db));
  const baseUrl = `${API_PREFIX}/distributions`;
  const authenticated = { preHandler: app.authenticate };

  app.get(
    `${baseUrl}/alliance-rate-tiers`,
    {
      ...authenticated,
      schema: {
        tags: ['distributions'],
        response: { 200: distributionAllianceRateTiersResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = identityFromRequest(request);
      return reply.send(
        success(service.getAllianceRateTiers(identity.userId, identity.guildId)),
      );
    },
  );

  app.put(
    `${baseUrl}/alliance-rate-tiers`,
    {
      ...authenticated,
      schema: {
        tags: ['distributions'],
        body: distributionAllianceRateTiersUpdateSchema,
        response: { 200: distributionAllianceRateTiersResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = identityFromRequest(request);
      const body = request.body as DistributionAllianceRateTiersUpdateBody;
      return reply.send(
        success(
          service.updateAllianceRateTiers(
            identity.userId,
            identity.guildId,
            body.tiers.map((tier) => ({ ...tier, allianceRate: decimalText(tier.allianceRate) })),
          ),
        ),
      );
    },
  );

  app.get(
    baseUrl,
    {
      ...authenticated,
      schema: {
        tags: ['distributions'],
        querystring: distributionListQuerySchema,
        response: { 200: distributionListResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = identityFromRequest(request);
      const query = request.query as DistributionListQuery;
      const periods = service.list(identity.userId, identity.guildId, query);
      return reply.send({ data: periods, meta: { total: periods.length } });
    },
  );

  app.get(
    `${baseUrl}/:id`,
    {
      ...authenticated,
      schema: {
        tags: ['distributions'],
        params: distributionParamsSchema,
        response: { 200: distributionDetailResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = identityFromRequest(request);
      const { id } = request.params as DistributionParams;
      return reply.send(success(service.get(identity.userId, identity.guildId, id)));
    },
  );

  app.post(
    baseUrl,
    {
      ...authenticated,
      schema: {
        tags: ['distributions'],
        body: distributionCreateSchema,
        response: { 201: distributionDetailResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = identityFromRequest(request);
      const body = request.body as DistributionCreateBody;
      const distributionDiamonds = decimalText(
        body.distributionDiamonds ??
          decimalSum(
            body.siegeDiamonds ?? body.totalFund,
            body.scrollCraftDiamonds ?? 0,
            body.instantReviveDiamonds ?? 0,
          ),
      );
      const distributionCash = decimalText(body.distributionCash ?? body.guildCash ?? 0);
      const hasReconciliationFields = [
        body.heldDiamonds,
        body.heldCash,
        body.allianceReceivedDiamonds,
        body.allianceReceivedCash,
        body.distributionDiamonds,
        body.distributionCash,
      ].some((value) => value !== undefined);
      const input: DistributionCreateInput = {
        title: body.title.trim(),
        startDate: body.startDate,
        endDate: body.endDate,
        totalFund: decimalText(body.totalFund),
        siegeDiamonds: decimalText(body.siegeDiamonds ?? body.totalFund),
        guildCash: decimalText(body.guildCash ?? 0),
        scrollCraftDiamonds: decimalText(body.scrollCraftDiamonds ?? 0),
        instantReviveDiamonds: decimalText(body.instantReviveDiamonds ?? 0),
        heldDiamonds: decimalText(
          body.heldDiamonds ?? (hasReconciliationFields ? 0 : distributionDiamonds),
        ),
        heldCash: decimalText(body.heldCash ?? (hasReconciliationFields ? 0 : distributionCash)),
        allianceReceivedDiamonds: decimalText(body.allianceReceivedDiamonds ?? 0),
        allianceReceivedCash: decimalText(body.allianceReceivedCash ?? 0),
        distributionDiamonds,
        distributionCash,
        deriveFundingTotal:
          hasReconciliationFields ||
          body.siegeDiamonds !== undefined ||
          body.guildCash !== undefined ||
          body.scrollCraftDiamonds !== undefined ||
          body.instantReviveDiamonds !== undefined,
        participationWeight: decimalText(body.participationWeight ?? 50),
        allianceWeight: decimalText(body.allianceWeight ?? 50),
        cashRate: decimalText(body.cashRate ?? 4.5),
        roundingMode: body.roundingMode ?? 'ROUND',
      };
      return reply
        .code(201)
        .send(success(service.create(identity.userId, identity.guildId, input)));
    },
  );

  app.patch(
    `${baseUrl}/:id`,
    {
      ...authenticated,
      schema: {
        tags: ['distributions'],
        params: distributionParamsSchema,
        body: distributionUpdateSchema,
        response: { 200: distributionDetailResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = identityFromRequest(request);
      const { id } = request.params as DistributionParams;
      const body = request.body as DistributionUpdateBody;
      const input: DistributionPeriodUpdateInput = {
        ...(body.title !== undefined ? { title: body.title.trim() } : {}),
        ...(body.startDate !== undefined ? { startDate: body.startDate } : {}),
        ...(body.endDate !== undefined ? { endDate: body.endDate } : {}),
        ...(body.totalFund !== undefined ? { totalFund: decimalText(body.totalFund) } : {}),
        ...(body.siegeDiamonds !== undefined
          ? { siegeDiamonds: decimalText(body.siegeDiamonds) }
          : {}),
        ...(body.guildCash !== undefined ? { guildCash: decimalText(body.guildCash) } : {}),
        ...(body.scrollCraftDiamonds !== undefined
          ? { scrollCraftDiamonds: decimalText(body.scrollCraftDiamonds) }
          : {}),
        ...(body.instantReviveDiamonds !== undefined
          ? { instantReviveDiamonds: decimalText(body.instantReviveDiamonds) }
          : {}),
        ...(body.heldDiamonds !== undefined
          ? { heldDiamonds: decimalText(body.heldDiamonds) }
          : {}),
        ...(body.heldCash !== undefined ? { heldCash: decimalText(body.heldCash) } : {}),
        ...(body.allianceReceivedDiamonds !== undefined
          ? { allianceReceivedDiamonds: decimalText(body.allianceReceivedDiamonds) }
          : {}),
        ...(body.allianceReceivedCash !== undefined
          ? { allianceReceivedCash: decimalText(body.allianceReceivedCash) }
          : {}),
        ...(body.distributionDiamonds !== undefined
          ? { distributionDiamonds: decimalText(body.distributionDiamonds) }
          : {}),
        ...(body.distributionCash !== undefined
          ? { distributionCash: decimalText(body.distributionCash) }
          : {}),
        ...(body.participationWeight !== undefined
          ? { participationWeight: decimalText(body.participationWeight) }
          : {}),
        ...(body.allianceWeight !== undefined
          ? { allianceWeight: decimalText(body.allianceWeight) }
          : {}),
        ...(body.cashRate !== undefined ? { cashRate: decimalText(body.cashRate) } : {}),
        ...(body.roundingMode !== undefined ? { roundingMode: body.roundingMode } : {}),
      };
      return reply.send(
        success(service.updatePeriod(identity.userId, identity.guildId, id, input)),
      );
    },
  );

  app.patch(
    `${baseUrl}/:id/members/:memberId`,
    {
      ...authenticated,
      schema: {
        tags: ['distributions'],
        params: distributionMemberParamsSchema,
        body: distributionMemberUpdateSchema,
        response: { 200: distributionDetailResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = identityFromRequest(request);
      const { id, memberId } = request.params as DistributionMemberParams;
      return reply.send(
        success(
          service.updateMember(
            identity.userId,
            identity.guildId,
            id,
            memberId,
            memberInput(request.body as DistributionMemberUpdateBody),
          ),
        ),
      );
    },
  );

  app.put(
    `${baseUrl}/:id/members`,
    {
      ...authenticated,
      schema: {
        tags: ['distributions'],
        params: distributionParamsSchema,
        body: distributionMembersBulkUpdateSchema,
        response: { 200: distributionDetailResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = identityFromRequest(request);
      const { id } = request.params as DistributionParams;
      const body = request.body as DistributionMembersBulkUpdateBody;
      return reply.send(
        success(
          service.updateMembersBulk(
            identity.userId,
            identity.guildId,
            id,
            body.members.map(({ memberId, ...values }) => ({
              memberId,
              values: memberInput(values),
            })),
          ),
        ),
      );
    },
  );

  for (const action of ['calculate', 'confirm'] as const) {
    app.post(
      `${baseUrl}/:id/${action}`,
      {
        ...authenticated,
        schema: {
          tags: ['distributions'],
          params: distributionParamsSchema,
          response: { 200: distributionDetailResponseSchema },
        },
      },
      async (request, reply) => {
        const identity = identityFromRequest(request);
        const { id } = request.params as DistributionParams;
        const result =
          action === 'calculate'
            ? service.calculate(identity.userId, identity.guildId, id)
            : service.confirm(identity.userId, identity.guildId, id);
        return reply.send(success(result));
      },
    );
  }

  app.post(
    `${baseUrl}/:id/reopen`,
    {
      ...authenticated,
      schema: {
        tags: ['distributions'],
        params: distributionParamsSchema,
        body: distributionReopenSchema,
        response: { 200: distributionDetailResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = identityFromRequest(request);
      const { id } = request.params as DistributionParams;
      const { reason } = request.body as DistributionReopenBody;
      return reply.send(success(service.reopen(identity.userId, identity.guildId, id, reason)));
    },
  );

  app.delete(
    `${baseUrl}/:id`,
    {
      ...authenticated,
      schema: {
        tags: ['distributions'],
        params: distributionParamsSchema,
        response: { 204: noContentResponseSchema },
      },
    },
    async (request, reply) => {
      const identity = identityFromRequest(request);
      const { id } = request.params as DistributionParams;
      service.delete(identity.userId, identity.guildId, id);
      return reply.code(204).send();
    },
  );
};
