import { Type, type Static } from '@sinclair/typebox';

const bossIdSchema = Type.Integer({ minimum: 1 });
const shortTextSchema = Type.String({ minLength: 1, maxLength: 100 });
const colorSchema = Type.Union([Type.String({ pattern: '^#[0-9A-Fa-f]{6}$' }), Type.Null()]);

const v1BossSchema = Type.Object({
  id: bossIdSchema,
  type: shortTextSchema,
  region: shortTextSchema,
  boss: shortTextSchema,
  cooldownHours: Type.Number({ minimum: 0, maximum: 1000 }),
  timeText: Type.Union([Type.String(), Type.Null()]),
  days: Type.Array(Type.String()),
  color: colorSchema,
  sortOrder: Type.Integer({ minimum: 0 }),
});

const legacyBossSchema = Type.Object({
  id: bossIdSchema,
  type: shortTextSchema,
  region: shortTextSchema,
  boss: shortTextSchema,
  cooldown: Type.Number({ minimum: 0, maximum: 1000 }),
  timeStr: Type.Union([Type.String(), Type.Null()]),
  days: Type.Union([Type.String(), Type.Null()]),
  color: colorSchema,
  sort_order: Type.Integer({ minimum: 0 }),
});

export const v1BossBodySchema = Type.Object(
  {
    type: shortTextSchema,
    region: Type.String({ maxLength: 100 }),
    boss: shortTextSchema,
    cooldownHours: Type.Number({ minimum: 0, maximum: 1000 }),
    timeText: Type.Optional(Type.Union([Type.String({ maxLength: 8 }), Type.Null()])),
    days: Type.Optional(Type.Array(Type.String({ maxLength: 1 }), { maxItems: 7 })),
    color: Type.Optional(colorSchema),
  },
  { additionalProperties: false },
);

export const legacyBossBodySchema = Type.Object(
  {
    type: shortTextSchema,
    region: Type.Optional(Type.String({ maxLength: 100 })),
    boss: shortTextSchema,
    cooldown: Type.Optional(Type.Number({ minimum: 0, maximum: 1000 })),
    timeStr: Type.Optional(Type.Union([Type.String({ maxLength: 8 }), Type.Null()])),
    days: Type.Optional(Type.Union([Type.String({ maxLength: 20 }), Type.Null()])),
    color: Type.Optional(colorSchema),
  },
  { additionalProperties: false },
);

export const bossParamsSchema = Type.Object({ id: bossIdSchema }, { additionalProperties: false });
export const v1BossOrderSchema = Type.Object(
  { bossIds: Type.Array(bossIdSchema, { minItems: 1, uniqueItems: true, maxItems: 500 }) },
  { additionalProperties: false },
);
export const legacyBossOrderSchema = Type.Object(
  {
    orderList: Type.Array(
      Type.Object(
        {
          boss: shortTextSchema,
          sort_order: Type.Integer({ minimum: 0, maximum: 10000 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 500 },
    ),
  },
  { additionalProperties: false },
);

export const v1BossListResponseSchema = Type.Object({ data: Type.Array(v1BossSchema) });
export const v1BossResponseSchema = Type.Object({ data: v1BossSchema });
export const legacyBossListResponseSchema = Type.Array(legacyBossSchema);
export const legacyBossCreatedResponseSchema = Type.Object({
  success: Type.Literal(true),
  id: bossIdSchema,
});
export const legacySuccessResponseSchema = Type.Object({ success: Type.Literal(true) });
export const noContentResponseSchema = Type.Null();

export type V1BossBody = Static<typeof v1BossBodySchema>;
export type LegacyBossBody = Static<typeof legacyBossBodySchema>;
export type BossParams = Static<typeof bossParamsSchema>;
export type V1BossOrderBody = Static<typeof v1BossOrderSchema>;
export type LegacyBossOrderBody = Static<typeof legacyBossOrderSchema>;
