import type { UserRole } from '../auth/auth.types';

export type SupportRequestStatus = 'OPEN' | 'MATCHED' | 'DONE' | 'CANCELED';
export type SupportApplicationStatus = 'APPLIED' | 'SELECTED';

export interface SupportActor {
  id: number;
  guildId: number;
  role: UserRole;
  isActive: boolean;
}

export interface SupportRequestSummary {
  id: number;
  guildId: number;
  requesterId: number;
  status: SupportRequestStatus;
  selectedApplicationId: number | null;
}

export interface SupportApplicationSummary {
  id: number;
  requestId: number;
  applicantId: number;
  status: SupportApplicationStatus;
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
}

export type SupportAuditAction =
  | 'REQUEST_CREATED'
  | 'REQUEST_STATUS_CHANGED'
  | 'REQUEST_DELETED'
  | 'APPLICATION_CREATED'
  | 'APPLICATION_CANCELED'
  | 'APPLICATION_SELECTED';
