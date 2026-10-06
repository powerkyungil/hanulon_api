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

const accountSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  guildId: Type.Integer({ minimum: 1 }),
  username: Type.String(),
  nickname: Type.String(),
  isActive: Type.Boolean(),
  activeCharacterKey: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
});

export const deputyCreateBodySchema = Type.Object(
  {
    username: Type.String({ minLength: 1, maxLength: 32, pattern: '^\\S+$' }),
    password: Type.String({ minLength: 6, maxLength: 72 }),
    nickname: Type.String({ minLength: 1, maxLength: 40 }),
  },
  { additionalProperties: false },
);

export const deputyPasswordBodySchema = Type.Object(
  { password: Type.String({ minLength: 6, maxLength: 72 }) },
  { additionalProperties: false },
);

export const deputyActiveBodySchema = Type.Object(
  { isActive: Type.Boolean() },
  { additionalProperties: false },
);

export const deputyAccountParamsSchema = Type.Object(
  { id: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);

export const deputyLoginBodySchema = Type.Object(
  {
    username: Type.String({ minLength: 1, maxLength: 32, pattern: '^\\S+$' }),
    password: Type.String({ minLength: 1, maxLength: 72 }),
  },
  { additionalProperties: false },
);

export const deputySelectCharacterBodySchema = Type.Object(
  { characterKey: Type.String({ pattern: '^(MAIN|ALTERNATE):[1-9]\\d*$' }) },
  { additionalProperties: false },
);

export const deputyAccountListResponseSchema = Type.Object({ data: Type.Array(accountSchema) });
export const deputyCharactersResponseSchema = Type.Object({ data: Type.Array(characterSchema) });
export const deputyCharacterResponseSchema = Type.Object({
  data: Type.Union([characterSchema, Type.Null()]),
});
export const deputyLoginResponseSchema = Type.Object({
  data: Type.Object({
    token: Type.String({ minLength: 1 }),
    deputyId: Type.Integer({ minimum: 1 }),
    guildId: Type.Integer({ minimum: 1 }),
    username: Type.String(),
    nickname: Type.String(),
    activeCharacter: Type.Union([characterSchema, Type.Null()]),
    permissions: Type.Array(Type.String()),
  }),
});
export const deputyCreatedResponseSchema = Type.Object({
  data: Type.Object({ id: Type.Integer({ minimum: 1 }) }),
});
export const noContentResponseSchema = Type.Null();

export type DeputyCreateBody = Static<typeof deputyCreateBodySchema>;
export type DeputyPasswordBody = Static<typeof deputyPasswordBodySchema>;
export type DeputyActiveBody = Static<typeof deputyActiveBodySchema>;
export type DeputyAccountParams = Static<typeof deputyAccountParamsSchema>;
export type DeputyLoginBody = Static<typeof deputyLoginBodySchema>;
export type DeputySelectCharacterBody = Static<typeof deputySelectCharacterBodySchema>;
