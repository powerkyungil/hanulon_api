import type { UserRole } from '../auth/auth.types';

export interface GuildActor {
  id: number;
  guildId: number;
  role: UserRole;
  isActive: boolean;
}

export interface GuildSettings {
  guildId: number;
  guildName: string;
  allowMemberCombatPowerEdit: boolean;
}

export interface GuildSettingsUpdate {
  guildName: string;
  allowMemberCombatPowerEdit: boolean;
}

export interface GuildInvite {
  inviteCode: string;
  role: 'MEMBER' | 'ADMIN';
}

export type InviteRole = GuildInvite['role'];

export type GuildAuditAction = 'SETTINGS_UPDATED' | 'INVITE_REPLACED';
