import { Type, type Static } from '@sinclair/typebox';

import { userRoles } from '../auth/auth.types';

const userRoleSchema = Type.Union(userRoles.map((role) => Type.Literal(role)));
const equipmentItemSchema = Type.Object({
  val: Type.String({ maxLength: 100 }),
  color: Type.String({ maxLength: 20 }),
});
const equipmentSchema = Type.Record(
  Type.String({ minLength: 1, maxLength: 40 }),
  equipmentItemSchema,
);
const skillMapSchema = Type.Record(
  Type.String({ minLength: 1, maxLength: 40 }),
  Type.String({ maxLength: 20 }),
);
const skillsSchema = Type.Object(
  {
    active: skillMapSchema,
    passive: skillMapSchema,
  },
  { additionalProperties: false },
);
const alternateCharacterSchema = Type.Object(
  {
    characterName: Type.String({ minLength: 1, maxLength: 30 }),
    mainClass: Type.String({ minLength: 1, maxLength: 30 }),
  },
  { additionalProperties: false },
);
const legacyAlternateCharacterSchema = Type.Object(
  {
    character_name: Type.String({ minLength: 1, maxLength: 30 }),
    main_class: Type.String({ minLength: 1, maxLength: 30 }),
  },
  { additionalProperties: false },
);

const profileUpdateFields = {
  nickname: Type.String({ minLength: 1, maxLength: 40 }),
  occupation: Type.String({ minLength: 1, maxLength: 30 }),
  mainClass: Type.String({ minLength: 1, maxLength: 30 }),
  combatPower: Type.Integer({ minimum: 0, maximum: 2147483647 }),
  equipment: equipmentSchema,
  skills: skillsSchema,
  maxCritRate: Type.Number({ minimum: 0 }),
  maxCritResist: Type.Number({ minimum: 0 }),
  statusEffectAcc: Type.Number({ minimum: 0 }),
  alternateCharacters: Type.Array(alternateCharacterSchema, { maxItems: 1 }),
  password: Type.Optional(Type.String({ minLength: 6, maxLength: 72 })),
} as const;

const legacyProfileUpdateFields = {
  nickname: profileUpdateFields.nickname,
  occupation: profileUpdateFields.occupation,
  main_class: Type.String({ minLength: 1, maxLength: 30 }),
  combat_power: profileUpdateFields.combatPower,
  equipment: profileUpdateFields.equipment,
  skills: profileUpdateFields.skills,
  max_crit_rate: profileUpdateFields.maxCritRate,
  max_crit_resist: profileUpdateFields.maxCritResist,
  status_effect_acc: profileUpdateFields.statusEffectAcc,
  alternate_characters: Type.Array(legacyAlternateCharacterSchema, { maxItems: 1 }),
  password: profileUpdateFields.password,
} as const;

const nullableString = Type.Union([Type.String(), Type.Null()]);
const nullableInteger = Type.Union([Type.Integer(), Type.Null()]);
const profileBaseResponseFields = {
  id: Type.Integer({ minimum: 1 }),
  username: Type.String(),
  role: userRoleSchema,
  nickname: Type.String(),
  occupation: nullableString,
  mainClass: nullableString,
  combatPower: nullableInteger,
  equipment: equipmentSchema,
  skills: skillsSchema,
  maxCritRate: Type.Number(),
  maxCritResist: Type.Number(),
  statusEffectAcc: Type.Number(),
  alternateCharacters: Type.Array(
    Type.Object({
      id: Type.Integer({ minimum: 1 }),
      characterName: Type.String(),
      mainClass: Type.String(),
    }),
  ),
} as const;
const legacyProfileBaseResponseFields = {
  id: profileBaseResponseFields.id,
  username: profileBaseResponseFields.username,
  role: profileBaseResponseFields.role,
  nickname: profileBaseResponseFields.nickname,
  occupation: profileBaseResponseFields.occupation,
  main_class: profileBaseResponseFields.mainClass,
  combat_power: profileBaseResponseFields.combatPower,
  equipment: profileBaseResponseFields.equipment,
  skills: profileBaseResponseFields.skills,
  max_crit_rate: profileBaseResponseFields.maxCritRate,
  max_crit_resist: profileBaseResponseFields.maxCritResist,
  status_effect_acc: profileBaseResponseFields.statusEffectAcc,
  alternate_characters: Type.Array(
    Type.Object({
      id: Type.Integer({ minimum: 1 }),
      character_name: Type.String(),
      main_class: Type.String(),
    }),
  ),
} as const;

export const profileUpdateBodySchema = Type.Object(profileUpdateFields, {
  additionalProperties: false,
});

export const legacyProfileUpdateBodySchema = Type.Object(legacyProfileUpdateFields, {
  additionalProperties: false,
});

export const profileResponseSchema = Type.Object(profileBaseResponseFields);
export const v1ProfileResponseSchema = Type.Object({ data: profileResponseSchema });
export const legacyProfileResponseSchema = Type.Object(legacyProfileBaseResponseFields);
export const memberListResponseSchema = Type.Object({
  data: Type.Array(profileResponseSchema),
});
export const legacyMemberListResponseSchema = Type.Array(legacyProfileResponseSchema);
export const memberIdParamsSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
});
export const roleUpdateBodySchema = Type.Object(
  {
    role: Type.Union([Type.Literal('MEMBER'), Type.Literal('ADMIN')]),
  },
  { additionalProperties: false },
);
export const masterTransferBodySchema = Type.Object(
  {
    targetUserId: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export const legacyMasterTransferBodySchema = Type.Object(
  {
    target_user_id: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export const noContentResponseSchema = Type.Null();
export const accountDeletionBodySchema = Type.Object(
  {
    password: Type.String({ minLength: 1, maxLength: 72 }),
  },
  { additionalProperties: false },
);

export type ProfileUpdateBody = Static<typeof profileUpdateBodySchema>;
export type LegacyProfileUpdateBody = Static<typeof legacyProfileUpdateBodySchema>;
export type MemberIdParams = Static<typeof memberIdParamsSchema>;
export type RoleUpdateBody = Static<typeof roleUpdateBodySchema>;
export type MasterTransferBody = Static<typeof masterTransferBodySchema>;
export type LegacyMasterTransferBody = Static<typeof legacyMasterTransferBodySchema>;
export type AccountDeletionBody = Static<typeof accountDeletionBodySchema>;
