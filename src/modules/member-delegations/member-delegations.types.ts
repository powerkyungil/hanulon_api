import type { CharacterIdentity } from '../../shared/character-identity';
import type { UserRole } from '../auth/auth.types';

export interface DelegationUser {
  id: number;
  guildId: number;
  username: string;
  nickname: string;
  role: UserRole;
  isActive: boolean;
}

export interface MemberDelegation {
  id: number;
  guildId: number;
  ownerUserId: number;
  ownerUsername: string;
  ownerNickname: string;
  deputyUserId: number;
  deputyUsername: string;
  deputyNickname: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export interface MemberDelegationLists {
  owned: MemberDelegation[];
  received: MemberDelegation[];
}

export interface MemberDelegationSession {
  owner: DelegationUser;
  deputy: DelegationUser;
  activeCharacter: CharacterIdentity;
}
