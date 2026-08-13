import { Type, type Static } from '@sinclair/typebox';

const diamondsSchema = Type.Integer({ minimum: 0, maximum: 999_999_999 });

const v1SiegeRecordSchema = Type.Object({
  userId: Type.Integer({ minimum: 1 }),
  nickname: Type.String(),
  mainClass: Type.String(),
  combatPower: Type.Integer({ minimum: 0 }),
  currentDiamonds: diamondsSchema,
  remainingDiamonds: diamondsSchema,
  usedDiamonds: diamondsSchema,
  updatedAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
});

const legacySiegeRecordSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  nickname: Type.String(),
  main_class: Type.String(),
  combat_power: Type.Integer({ minimum: 0 }),
  current_diamonds: diamondsSchema,
  remaining_diamonds: diamondsSchema,
  updated_at: Type.Union([Type.String(), Type.Null()]),
});

export const v1SiegeInputSchema = Type.Object(
  {
    currentDiamonds: diamondsSchema,
    remainingDiamonds: diamondsSchema,
  },
  { additionalProperties: false },
);

export const legacySiegeInputSchema = Type.Object(
  {
    current_diamonds: diamondsSchema,
    remaining_diamonds: diamondsSchema,
  },
  { additionalProperties: false },
);

export const siegeMemberParamsSchema = Type.Object(
  { id: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);

export const v1SiegeListResponseSchema = Type.Object({
  data: Type.Array(v1SiegeRecordSchema),
});
export const legacySiegeListResponseSchema = Type.Array(legacySiegeRecordSchema);
export const legacySuccessResponseSchema = Type.Object({ success: Type.Literal(true) });
export const noContentResponseSchema = Type.Null();

export type V1SiegeInputBody = Static<typeof v1SiegeInputSchema>;
export type LegacySiegeInputBody = Static<typeof legacySiegeInputSchema>;
export type SiegeMemberParams = Static<typeof siegeMemberParamsSchema>;
