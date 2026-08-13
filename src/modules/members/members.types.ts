import type { Equipment, Skills, UserRole } from '../auth/auth.types';

export interface AlternateCharacter {
  id: number;
  characterName: string;
  mainClass: string;
}

export interface UserProfile {
  id: number;
  guildId: number;
  username: string;
  role: UserRole;
  nickname: string;
  occupation: string | null;
  mainClass: string | null;
  combatPower: number | null;
  equipment: Equipment;
  skills: Skills;
  maxCritRate: number;
  maxCritResist: number;
  statusEffectAcc: number;
  alternateCharacters: AlternateCharacter[];
}

export interface ProfileUpdateInput {
  nickname: string;
  occupation: string;
  mainClass: string;
  combatPower: number;
  equipment: Equipment;
  skills: Skills;
  maxCritRate: number;
  maxCritResist: number;
  statusEffectAcc: number;
  alternateCharacters: Array<{
    characterName: string;
    mainClass: string;
  }>;
  password?: string;
}

export interface ProfileIdentity {
  id: number;
  guildId: number;
  username: string;
  role: UserRole;
  nickname: string;
  isActive: boolean;
}

export interface GuildProfileSettings {
  allowMemberCombatPowerEdit: boolean;
}

export type MemberAuditAction =
  'ROLE_CHANGED' | 'MASTER_TRANSFERRED' | 'PASSWORD_RESET' | 'MEMBER_REMOVED';
