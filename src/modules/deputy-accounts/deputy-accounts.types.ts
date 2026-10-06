import type { CharacterIdentity } from '../../shared/character-identity';
import type { UserRole } from '../auth/auth.types';

export type { CharacterType } from '../../shared/character-identity';

export interface DeputyAccount {
  id: number;
  guildId: number;
  username: string;
  nickname: string;
  isActive: boolean;
  activeCharacterKey: string | null;
  createdAt: string;
}

export interface DeputyAccountCredentials extends DeputyAccount {
  passwordHash: string;
  tokenVersion: number;
}

export interface DeputyActor {
  id: number;
  guildId: number;
  role: UserRole;
  isActive: boolean;
}

export type DeputyCharacter = CharacterIdentity;
