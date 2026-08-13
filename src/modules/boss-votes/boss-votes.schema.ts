import { Type, type Static } from '@sinclair/typebox';

const nameSchema = Type.String({ minLength: 1, maxLength: 100 });
const spawnTimeSchema = Type.Integer({ minimum: 0, maximum: 8_640_000_000_000_000 });
const participantSchema = Type.Object({
  userId: Type.Integer({ minimum: 1 }),
  nickname: Type.String(),
});
const voteSchema = Type.Object({
  id: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  voteKey: Type.String({ minLength: 1, maxLength: 500 }),
  type: nameSchema,
  region: Type.String({ maxLength: 100 }),
  boss: nameSchema,
  spawnTime: spawnTimeSchema,
  participants: Type.Array(participantSchema),
  participantCount: Type.Integer({ minimum: 0 }),
  joined: Type.Boolean(),
  isClosed: Type.Boolean(),
  isBlessed: Type.Boolean(),
  isManual: Type.Boolean(),
  isHistory: Type.Boolean(),
  isFixed: Type.Boolean(),
});

export const manualVoteBodySchema = Type.Object(
  {
    boss: nameSchema,
    spawnTime: spawnTimeSchema,
    type: nameSchema,
    region: Type.String({ maxLength: 100 }),
    isBlessed: Type.Boolean(),
  },
  { additionalProperties: false },
);
export const voteParamsSchema = Type.Object(
  { voteKey: Type.String({ minLength: 1, maxLength: 500 }) },
  { additionalProperties: false },
);
export const voteToggleBodySchema = Type.Object(
  { boss: nameSchema, spawnTime: spawnTimeSchema },
  { additionalProperties: false },
);
export const manualVoteParamsSchema = Type.Object(
  { id: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export const voteCloseBodySchema = Type.Object(
  { boss: nameSchema, spawnTime: spawnTimeSchema },
  { additionalProperties: false },
);
export const voteParticipantParamsSchema = Type.Object(
  {
    voteKey: Type.String({ minLength: 1, maxLength: 500 }),
    userId: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export const voteStatsQuerySchema = Type.Object(
  { month: Type.String({ pattern: '^\\d{4}-\\d{2}$' }) },
  { additionalProperties: false },
);
export const voteMemberRatesQuerySchema = Type.Object(
  {
    start: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
    end: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  },
  { additionalProperties: false },
);

export const legacyVoteListResponseSchema = Type.Array(voteSchema);
export const v1VoteListResponseSchema = Type.Object({ data: Type.Array(voteSchema) });
export const legacyCreatedResponseSchema = Type.Object({
  success: Type.Literal(true),
  id: Type.Integer({ minimum: 1 }),
});
export const v1CreatedResponseSchema = Type.Object({
  data: Type.Object({
    id: Type.Integer({ minimum: 1 }),
    voteKey: Type.String({ minLength: 1 }),
  }),
});
export const legacyToggleResponseSchema = Type.Object({ joined: Type.Boolean() });
export const legacySuccessResponseSchema = Type.Object({ success: Type.Literal(true) });
export const legacyClosedResponseSchema = Type.Object({
  success: Type.Literal(true),
  state: Type.Literal('INACTIVE'),
});
export const v1ToggleResponseSchema = Type.Object({
  data: Type.Object({ joined: Type.Boolean() }),
});

export type ManualVoteBody = Static<typeof manualVoteBodySchema>;
export type VoteParams = Static<typeof voteParamsSchema>;
export type VoteToggleBody = Static<typeof voteToggleBodySchema>;
export type ManualVoteParams = Static<typeof manualVoteParamsSchema>;
export type VoteCloseBody = Static<typeof voteCloseBodySchema>;
export type VoteParticipantParams = Static<typeof voteParticipantParamsSchema>;
export type VoteStatsQuery = Static<typeof voteStatsQuerySchema>;
export type VoteMemberRatesQuery = Static<typeof voteMemberRatesQuerySchema>;
