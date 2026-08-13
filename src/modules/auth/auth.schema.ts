import { Type, type Static } from '@sinclair/typebox';

import { registrationModes, userRoles } from './auth.types';

const userRoleSchema = Type.Union(userRoles.map((role) => Type.Literal(role)));
const registrationModeSchema = Type.Union(registrationModes.map((mode) => Type.Literal(mode)));
const usernameSchema = Type.String({ minLength: 1, maxLength: 32, pattern: '^\\S+$' });
const loginPasswordSchema = Type.String({ minLength: 1, maxLength: 72 });
const passwordSchema = Type.String({ minLength: 6, maxLength: 72 });
const stringMapSchema = Type.Record(
  Type.String({ minLength: 1, maxLength: 40 }),
  Type.String({ maxLength: 100 }),
);
const equipmentItemSchema = Type.Object({
  val: Type.String({ maxLength: 100 }),
  color: Type.String({ maxLength: 20 }),
});

export const loginBodySchema = Type.Object(
  {
    username: usernameSchema,
    password: loginPasswordSchema,
  },
  { additionalProperties: false },
);

export const registerBodySchema = Type.Object(
  {
    mode: registrationModeSchema,
    code: Type.Optional(Type.String({ minLength: 1, maxLength: 32, pattern: '^[A-Za-z0-9_-]+$' })),
    guild_name: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
    username: usernameSchema,
    password: passwordSchema,
    nickname: Type.String({ minLength: 1, maxLength: 40 }),
    occupation: Type.String({ minLength: 1, maxLength: 30 }),
    main_class: Type.String({ minLength: 1, maxLength: 30 }),
    combat_power: Type.Integer({ minimum: 0, maximum: 2147483647 }),
    equipment: Type.Record(Type.String({ minLength: 1, maxLength: 40 }), equipmentItemSchema),
    skills: Type.Object(
      {
        active: stringMapSchema,
        passive: stringMapSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const authSessionSchema = Type.Object({
  token: Type.String({ minLength: 1 }),
  userId: Type.Integer({ minimum: 1 }),
  username: Type.String(),
  nickname: Type.String(),
  role: userRoleSchema,
});

export const v1SessionResponseSchema = Type.Object({
  data: authSessionSchema,
});

export const legacySessionResponseSchema = authSessionSchema;

export const registrationResponseSchema = Type.Object({
  userId: Type.Integer({ minimum: 1 }),
  guildId: Type.Integer({ minimum: 1 }),
  role: userRoleSchema,
});

export const v1RegistrationResponseSchema = Type.Object({
  data: registrationResponseSchema,
});

export const legacyRegistrationResponseSchema = registrationResponseSchema;

export type LoginBody = Static<typeof loginBodySchema>;
export type RegisterBody = Static<typeof registerBodySchema>;
