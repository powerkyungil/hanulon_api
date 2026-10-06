import { Type, type Static } from '@sinclair/typebox';

const decimalInputSchema = Type.Union([
  Type.Number({ minimum: 0 }),
  Type.String({ pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d+)?$' }),
]);
const decimalOutputSchema = Type.String();
const dateSchema = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });
const roundingModeSchema = Type.Union([
  Type.Literal('NONE'),
  Type.Literal('ROUND'),
  Type.Literal('CEIL'),
  Type.Literal('FLOOR'),
]);

export const distributionParamsSchema = Type.Object(
  { id: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);

export const distributionMemberParamsSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    memberId: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const distributionListQuerySchema = Type.Object(
  {
    status: Type.Optional(Type.Union([Type.Literal('DRAFT'), Type.Literal('CONFIRMED')])),
    startDate: Type.Optional(dateSchema),
    endDate: Type.Optional(dateSchema),
  },
  { additionalProperties: false },
);

const distributionAllianceRateTierSchema = Type.Object(
  {
    minCombatPower: Type.Integer({ minimum: 80000 }),
    maxCombatPower: Type.Integer({ minimum: 80000 }),
    allianceRate: decimalInputSchema,
  },
  { additionalProperties: false },
);

export const distributionAllianceRateTiersUpdateSchema = Type.Object(
  { tiers: Type.Array(distributionAllianceRateTierSchema, { maxItems: 200 }) },
  { additionalProperties: false },
);

export const distributionAllianceRateTiersResponseSchema = Type.Object({
  data: Type.Array(
    Type.Object({
      minCombatPower: Type.Integer({ minimum: 80000 }),
      maxCombatPower: Type.Integer({ minimum: 80000 }),
      allianceRate: decimalOutputSchema,
    }),
  ),
});

const periodInputProperties = {
  title: Type.String({ minLength: 1, maxLength: 100 }),
  startDate: dateSchema,
  endDate: dateSchema,
  totalFund: decimalInputSchema,
  siegeDiamonds: decimalInputSchema,
  guildCash: decimalInputSchema,
  scrollCraftDiamonds: decimalInputSchema,
  instantReviveDiamonds: decimalInputSchema,
  heldDiamonds: decimalInputSchema,
  heldCash: decimalInputSchema,
  allianceReceivedDiamonds: decimalInputSchema,
  allianceReceivedCash: decimalInputSchema,
  distributionDiamonds: decimalInputSchema,
  distributionCash: decimalInputSchema,
  participationWeight: decimalInputSchema,
  allianceWeight: decimalInputSchema,
  cashRate: decimalInputSchema,
  roundingMode: roundingModeSchema,
};

export const distributionCreateSchema = Type.Object(
  {
    ...periodInputProperties,
    participationWeight: Type.Optional(decimalInputSchema),
    allianceWeight: Type.Optional(decimalInputSchema),
    cashRate: Type.Optional(decimalInputSchema),
    roundingMode: Type.Optional(roundingModeSchema),
    siegeDiamonds: Type.Optional(decimalInputSchema),
    guildCash: Type.Optional(decimalInputSchema),
    scrollCraftDiamonds: Type.Optional(decimalInputSchema),
    instantReviveDiamonds: Type.Optional(decimalInputSchema),
    heldDiamonds: Type.Optional(decimalInputSchema),
    heldCash: Type.Optional(decimalInputSchema),
    allianceReceivedDiamonds: Type.Optional(decimalInputSchema),
    allianceReceivedCash: Type.Optional(decimalInputSchema),
    distributionDiamonds: Type.Optional(decimalInputSchema),
    distributionCash: Type.Optional(decimalInputSchema),
  },
  { additionalProperties: false },
);

export const distributionUpdateSchema = Type.Partial(
  Type.Object(periodInputProperties, { additionalProperties: false }),
);

const memberInputProperties = {
  participationRate: Type.Union([decimalInputSchema, Type.Null()]),
  allianceRate: decimalInputSchema,
  payoutMultiplier: decimalInputSchema,
  instantReviveCost: decimalInputSchema,
  goldSupportCost: decimalInputSchema,
  operationCost: decimalInputSchema,
  otherSupportCost: decimalInputSchema,
  note: Type.Union([Type.String({ maxLength: 1000 }), Type.Null()]),
};

export const distributionMemberUpdateSchema = Type.Partial(
  Type.Object(memberInputProperties, { additionalProperties: false }),
  { minProperties: 1 },
);

export const distributionMembersBulkUpdateSchema = Type.Object(
  {
    members: Type.Array(
      Type.Object(
        {
          memberId: Type.Integer({ minimum: 1 }),
          participationRate: Type.Optional(memberInputProperties.participationRate),
          allianceRate: Type.Optional(memberInputProperties.allianceRate),
          payoutMultiplier: Type.Optional(memberInputProperties.payoutMultiplier),
          instantReviveCost: Type.Optional(memberInputProperties.instantReviveCost),
          goldSupportCost: Type.Optional(memberInputProperties.goldSupportCost),
          operationCost: Type.Optional(memberInputProperties.operationCost),
          otherSupportCost: Type.Optional(memberInputProperties.otherSupportCost),
          note: Type.Optional(memberInputProperties.note),
        },
        { additionalProperties: false },
      ),
      { maxItems: 1000 },
    ),
  },
  { additionalProperties: false },
);

export const distributionReopenSchema = Type.Object(
  { reason: Type.String({ minLength: 1, maxLength: 500 }) },
  { additionalProperties: false },
);

const distributionPeriodSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  title: Type.String(),
  startDate: dateSchema,
  endDate: dateSchema,
  status: Type.Union([Type.Literal('DRAFT'), Type.Literal('CONFIRMED')]),
  totalFund: decimalOutputSchema,
  siegeDiamonds: decimalOutputSchema,
  guildCash: decimalOutputSchema,
  scrollCraftDiamonds: decimalOutputSchema,
  instantReviveDiamonds: decimalOutputSchema,
  heldDiamonds: decimalOutputSchema,
  heldCash: decimalOutputSchema,
  allianceReceivedDiamonds: decimalOutputSchema,
  allianceReceivedCash: decimalOutputSchema,
  distributionDiamonds: decimalOutputSchema,
  distributionCash: decimalOutputSchema,
  participationWeight: decimalOutputSchema,
  allianceWeight: decimalOutputSchema,
  cashRate: decimalOutputSchema,
  roundingMode: roundingModeSchema,
  createdBy: Type.Integer({ minimum: 0 }),
  createdAt: Type.Integer({ minimum: 0 }),
  updatedAt: Type.Integer({ minimum: 0 }),
  confirmedAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  confirmedBy: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
});

const distributionMemberSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  userId: Type.Integer({ minimum: 1 }),
  nickname: Type.String(),
  occupation: Type.Union([Type.String(), Type.Null()]),
  mainClass: Type.Union([Type.String(), Type.Null()]),
  combatPower: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  participationRate: Type.Union([decimalOutputSchema, Type.Null()]),
  allianceRate: decimalOutputSchema,
  payoutMultiplier: decimalOutputSchema,
  instantReviveCost: decimalOutputSchema,
  goldSupportCost: decimalOutputSchema,
  operationCost: decimalOutputSchema,
  otherSupportCost: decimalOutputSchema,
  note: Type.Union([Type.String(), Type.Null()]),
  participationShare: decimalOutputSchema,
  allianceShare: decimalOutputSchema,
  participationAmount: decimalOutputSchema,
  allianceAmount: decimalOutputSchema,
  supportTotal: decimalOutputSchema,
  finalDiamonds: decimalOutputSchema,
  payableDiamonds: decimalOutputSchema,
  roundingAdjustment: decimalOutputSchema,
  cashAmount: decimalOutputSchema,
});

const calculationTotalsSchema = Type.Object({
  supportTotal: decimalOutputSchema,
  baseFund: decimalOutputSchema,
  participationPool: decimalOutputSchema,
  alliancePool: decimalOutputSchema,
  participationAllocated: decimalOutputSchema,
  allianceAllocated: decimalOutputSchema,
  finalDiamonds: decimalOutputSchema,
  payableDiamonds: decimalOutputSchema,
  roundingDifference: decimalOutputSchema,
  cashAmount: decimalOutputSchema,
  undistributedDiamonds: decimalOutputSchema,
  fundingTotalCash: decimalOutputSchema,
  baseFundCash: decimalOutputSchema,
  supportTotalCash: decimalOutputSchema,
});

const fundingSummarySchema = Type.Object({
  availableDiamonds: decimalOutputSchema,
  availableCash: decimalOutputSchema,
  distributionDiamonds: decimalOutputSchema,
  distributionCash: decimalOutputSchema,
  remainingDiamonds: decimalOutputSchema,
  remainingCash: decimalOutputSchema,
});

export const distributionListResponseSchema = Type.Object({
  data: Type.Array(distributionPeriodSchema),
  meta: Type.Object({ total: Type.Integer({ minimum: 0 }) }),
});

export const distributionDetailResponseSchema = Type.Object({
  data: Type.Composite([
    distributionPeriodSchema,
    Type.Object({
      members: Type.Array(distributionMemberSchema),
      totals: calculationTotalsSchema,
      fundingSummary: fundingSummarySchema,
    }),
  ]),
});

export const noContentResponseSchema = Type.Null();

export type DistributionParams = Static<typeof distributionParamsSchema>;
export type DistributionAllianceRateTiersUpdateBody = Static<
  typeof distributionAllianceRateTiersUpdateSchema
>;
export type DistributionMemberParams = Static<typeof distributionMemberParamsSchema>;
export type DistributionListQuery = Static<typeof distributionListQuerySchema>;
export type DistributionCreateBody = Static<typeof distributionCreateSchema>;
export type DistributionUpdateBody = Static<typeof distributionUpdateSchema>;
export type DistributionMemberUpdateBody = Static<typeof distributionMemberUpdateSchema>;
export type DistributionMembersBulkUpdateBody = Static<typeof distributionMembersBulkUpdateSchema>;
export type DistributionReopenBody = Static<typeof distributionReopenSchema>;
