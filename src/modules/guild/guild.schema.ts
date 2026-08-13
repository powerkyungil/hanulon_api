import { Type, type Static } from '@sinclair/typebox';

const inviteRoleSchema = Type.Union([Type.Literal('MEMBER'), Type.Literal('ADMIN')]);
const inviteSchema = Type.Object({
  inviteCode: Type.String({ minLength: 4, maxLength: 32 }),
  role: inviteRoleSchema,
});
const guildSettingsSchema = Type.Object({
  guildName: Type.String({ minLength: 1, maxLength: 40 }),
  allowMemberCombatPowerEdit: Type.Boolean(),
});
const legacyGuildSettingsSchema = Type.Object({
  guild_name: Type.String({ minLength: 1, maxLength: 40 }),
  allow_member_combat_power_edit: Type.Union([Type.Literal(0), Type.Literal(1)]),
});

export const v1GuildSettingsResponseSchema = Type.Object({ data: guildSettingsSchema });
export const legacyGuildSettingsResponseSchema = legacyGuildSettingsSchema;

export const guildSettingsUpdateBodySchema = guildSettingsSchema;
export const legacyGuildSettingsUpdateBodySchema = Type.Object(
  {
    guild_name: Type.String({ minLength: 1, maxLength: 40 }),
    allow_member_combat_power_edit: Type.Union([Type.Literal(0), Type.Literal(1)]),
    discord_token: Type.Optional(Type.String()),
    discord_channel_id: Type.Optional(Type.String()),
    discord_enabled: Type.Optional(Type.Integer()),
  },
  { additionalProperties: false },
);

export const v1InviteListResponseSchema = Type.Object({ data: Type.Array(inviteSchema) });
export const legacyInviteListResponseSchema = Type.Object({
  invites: Type.Array(inviteSchema),
});

export const inviteUpsertBodySchema = Type.Object(
  {
    targetRole: inviteRoleSchema,
    customCode: Type.Optional(
      Type.String({ minLength: 4, maxLength: 32, pattern: '^[A-Za-z0-9_-]+$' }),
    ),
  },
  { additionalProperties: false },
);
export const v1InviteResponseSchema = Type.Object({ data: inviteSchema });
export const legacyInviteResponseSchema = inviteSchema;
export const noContentResponseSchema = Type.Null();

export type GuildSettingsUpdateBody = Static<typeof guildSettingsUpdateBodySchema>;
export type LegacyGuildSettingsUpdateBody = Static<typeof legacyGuildSettingsUpdateBodySchema>;
export type InviteUpsertBody = Static<typeof inviteUpsertBodySchema>;
