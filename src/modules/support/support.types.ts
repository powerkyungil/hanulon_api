import type { UserRole } from '../auth/auth.types';
import type { CharacterType } from '../../shared/character-identity';

export type SupportRequestStatus = 'OPEN' | 'MATCHED' | 'DONE' | 'CANCELED';
export type SupportApplicationStatus = 'APPLIED' | 'SELECTED';

export interface SupportActor {
  id: number;
  guildId: number;
  role: UserRole;
  isActive: boolean;
  deputyId?: number;
  actorNickname?: string;
  characterType?: CharacterType;
}

export interface SupportRequestSummary {
  id: number;
  guildId: number;
  requesterId: number;
  status: SupportRequestStatus;
  selectedApplicationId: number | null;
  requesterCharacterType: CharacterType;
}

export interface SupportApplicationSummary {
  id: number;
  requestId: number;
  applicantId: number;
  status: SupportApplicationStatus;
  applicantCharacterType: CharacterType;
}

export interface SupportApplication extends SupportApplicationSummary {
  memo: string;
  createdAt: number;
  nickname: string;
  occupation: string;
  mainClass: string;
  combatPower: number;
}

export interface SupportRequest extends SupportRequestSummary {
  requestedTime: string;
  memo: string;
  createdAt: number;
  updatedAt: number;
  nickname: string;
  occupation: string;
  mainClass: string;
  combatPower: number;
  applications: SupportApplication[];
}

export interface SupportRequestInput {
  requestedTime: string;
  memo: string;
  characterType?: CharacterType;
}

export type SupportAuditAction =
  | 'REQUEST_CREATED'
  | 'REQUEST_STATUS_CHANGED'
  | 'REQUEST_DELETED'
  | 'APPLICATION_CREATED'
  | 'APPLICATION_CANCELED'
  | 'APPLICATION_SELECTED';
