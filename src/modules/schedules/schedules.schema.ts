import { Type, type Static } from '@sinclair/typebox';

const nameSchema = Type.String({ minLength: 1, maxLength: 100 });
const spawnTimeSchema = Type.Integer({ minimum: 0, maximum: 8_640_000_000_000_000 });
const scheduleInputSchema = Type.Object(
  {
    type: nameSchema,
    region: nameSchema,
    boss: nameSchema,
    spawnTime: spawnTimeSchema,
  },
  { additionalProperties: false },
);
const v1ScheduleInputSchema = Type.Object(
  {
    bossDefinitionId: Type.Integer({ minimum: 1 }),
    type: nameSchema,
    region: nameSchema,
    boss: nameSchema,
    spawnTime: spawnTimeSchema,
  },
  { additionalProperties: false },
);

const v1ScheduleSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  bossDefinitionId: Type.Integer({ minimum: 1 }),
  type: nameSchema,
  region: nameSchema,
  boss: nameSchema,
  spawnTime: spawnTimeSchema,
  isMung: Type.Boolean(),
  isFixed: Type.Literal(false),
});

const legacyScheduleSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  type: nameSchema,
  region: nameSchema,
  boss: nameSchema,
  spawnTime: spawnTimeSchema,
  is_mung: Type.Integer({ minimum: 0, maximum: 1 }),
  isFixed: Type.Literal(false),
});

export const legacyScheduleListBodySchema = Type.Array(scheduleInputSchema, {
  minItems: 1,
  maxItems: 500,
});
export const v1ScheduleListBodySchema = Type.Object(
  { schedules: Type.Array(v1ScheduleInputSchema, { minItems: 1, maxItems: 500 }) },
  { additionalProperties: false },
);
export const scheduleKeyBodySchema = Type.Object(
  { type: nameSchema, region: nameSchema, boss: nameSchema },
  { additionalProperties: false },
);
export const scheduleMungBodySchema = Type.Object(
  {
    type: nameSchema,
    region: nameSchema,
    boss: nameSchema,
    currentSpawnTime: spawnTimeSchema,
  },
  { additionalProperties: false },
);
export const scheduleParamsSchema = Type.Object(
  { id: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export const participantParamsSchema = Type.Object(
  { boss: nameSchema },
  { additionalProperties: false },
);
export const participationToggleBodySchema = Type.Object(
  { type: nameSchema, region: nameSchema, spawnTime: spawnTimeSchema },
  { additionalProperties: false },
);
export const legacyParticipationTargetsBodySchema = Type.Object(
  { bosses: Type.Array(nameSchema, { maxItems: 500, uniqueItems: true }) },
  { additionalProperties: false },
);
export const v1ParticipationTargetsBodySchema = Type.Object(
  { bossDefinitionIds: Type.Array(Type.Integer({ minimum: 1 }), { maxItems: 500, uniqueItems: true }) },
  { additionalProperties: false },
);

export const v1ScheduleListResponseSchema = Type.Object({ data: Type.Array(v1ScheduleSchema) });
export const legacyScheduleListResponseSchema = Type.Array(legacyScheduleSchema);
export const v1CreatedResponseSchema = Type.Object({
  data: Type.Object({ createdCount: Type.Integer({ minimum: 1 }) }),
});
export const v1NextSpawnResponseSchema = Type.Object({
  data: Type.Object({ nextSpawnTime: spawnTimeSchema }),
});
export const legacyNextSpawnResponseSchema = Type.Object({
  success: Type.Literal(true),
  nextSpawn: spawnTimeSchema,
});
export const legacySuccessResponseSchema = Type.Object({ success: Type.Literal(true) });
export const v1TargetListResponseSchema = Type.Object({
  data: Type.Object({ bossDefinitionIds: Type.Array(Type.Integer({ minimum: 1 })) }),
});
export const v1StringSetResponseSchema = Type.Object({ data: Type.Array(Type.String()) });
export const legacyTargetListResponseSchema = Type.Array(Type.String());
export const participantMapSchema = Type.Record(Type.String(), Type.Array(Type.String()));
export const v1ParticipantMapResponseSchema = Type.Object({ data: participantMapSchema });
export const v1ToggleResponseSchema = Type.Object({
  data: Type.Object({ joined: Type.Boolean() }),
});
export const legacyToggleResponseSchema = Type.Object({ joined: Type.Boolean() });
export const noContentResponseSchema = Type.Null();

export type ScheduleInputBody = Static<typeof scheduleInputSchema>;
export type LegacyScheduleListBody = Static<typeof legacyScheduleListBodySchema>;
export type V1ScheduleListBody = Static<typeof v1ScheduleListBodySchema>;
export type ScheduleKeyBody = Static<typeof scheduleKeyBodySchema>;
export type ScheduleMungBody = Static<typeof scheduleMungBodySchema>;
export type ScheduleParams = Static<typeof scheduleParamsSchema>;
export type ParticipantParams = Static<typeof participantParamsSchema>;
export type ParticipationToggleBody = Static<typeof participationToggleBodySchema>;
export type LegacyParticipationTargetsBody = Static<typeof legacyParticipationTargetsBodySchema>;
export type V1ParticipationTargetsBody = Static<typeof v1ParticipationTargetsBodySchema>;
