import { Type, type Static } from '@sinclair/typebox';

const characterSchema = Type.Object({
  characterKey: Type.String({ pattern: '^(MAIN|ALTERNATE):[1-9]\\d*$' }),
  characterType: Type.Union([Type.Literal('MAIN'), Type.Literal('ALTERNATE')]),
  ownerUserId: Type.Integer({ minimum: 1 }),
  ownerNickname: Type.String(),
  characterName: Type.String(),
  mainClass: Type.String(),
  combatPower: Type.Integer({ minimum: 0 }),
});

const delegationSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  guildId: Type.Integer({ minimum: 1 }),
  ownerUserId: Type.Integer({ minimum: 1 }),
  ownerUsername: Type.String(),
  ownerNickname: Type.String(),
  deputyUserId: Type.Integer({ minimum: 1 }),
  deputyUsername: Type.String(),
  deputyNickname: Type.String(),
  isActive: Type.Boolean(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  revokedAt: Type.Union([Type.String(), Type.Null()]),
});

export const memberDelegationCreateBodySchema = Type.Object(
  {
    deputyUserId: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const memberDelegationSessionBodySchema = Type.Object(
  {
    ownerUserId: Type.Integer({ minimum: 1 }),
    characterKey: Type.Optional(Type.String({ pattern: '^(MAIN|ALTERNATE):[1-9]\\d*$' })),
  },
  { additionalProperties: false },
);

export const memberDelegationParamsSchema = Type.Object(
  {
    deputyUserId: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const memberDelegationListResponseSchema = Type.Object({
  data: Type.Object({
    owned: Type.Array(delegationSchema),
    received: Type.Array(delegationSchema),
  }),
});

export const memberDelegationResponseSchema = Type.Object({ data: delegationSchema });

export const memberDelegationSessionResponseSchema = Type.Object({
  data: Type.Object({
    token: Type.String({ minLength: 1 }),
    guildId: Type.Integer({ minimum: 1 }),
    ownerUserId: Type.Integer({ minimum: 1 }),
    ownerUsername: Type.String(),
    ownerNickname: Type.String(),
    deputyUserId: Type.Integer({ minimum: 1 }),
    deputyUsername: Type.String(),
    deputyNickname: Type.String(),
    activeCharacter: characterSchema,
    principalType: Type.Literal('MEMBER_DEPUTY'),
  }),
});

export const noContentResponseSchema = Type.Null();

export type MemberDelegationCreateBody = Static<typeof memberDelegationCreateBodySchema>;
export type MemberDelegationSessionBody = Static<typeof memberDelegationSessionBodySchema>;
export type MemberDelegationParams = Static<typeof memberDelegationParamsSchema>;
