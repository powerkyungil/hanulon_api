import type { UserRole } from '../auth/auth.types';

export interface ContentGroupActor {
  id: number;
  guildId: number;
  role: UserRole;
  isActive: boolean;
}

export interface ContentGroup {
  id: number;
  guildId: number;
  name: string;
  memberIds: number[];
}

export type ContentGroupAuditAction =
  'GROUP_CREATED' | 'GROUP_RENAMED' | 'GROUP_DELETED' | 'MEMBERS_REPLACED';
