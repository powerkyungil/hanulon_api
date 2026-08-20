import type { UserRole } from '../auth/auth.types';

export interface CollectionActor {
  id: number;
  guildId: number;
  username: string;
  role: UserRole;
  isActive: boolean;
}

export interface CollectionItem {
  id: number;
  part: string;
  enchantment: string;
  sortOrder: number;
}

export interface ItemCollection {
  id: number;
  guildId: number;
  name: string;
  items: CollectionItem[];
}

export interface CollectionItemInput {
  id?: number;
  part: string;
  enchantment: string;
}

export interface CollectionInput {
  name: string;
  items: CollectionItemInput[];
}

export interface CollectionCompletion {
  userId: number;
  collectionItemId: number;
}

export interface CollectionCompletionLog {
  id: number;
  actorUserId: number;
  actorNickname: string | null;
  targetUserId: number;
  targetNickname: string | null;
  collectionId: number;
  collectionName: string;
  collectionItemId: number;
  part: string;
  enchantment: string;
  completed: boolean;
  createdAt: number;
}

export interface CollectionCompletionLogPage {
  items: CollectionCompletionLog[];
  nextCursor: number | null;
}

export type CollectionMutationStatus = 'added' | 'removed';

export type CollectionAuditAction =
  | 'COLLECTION_CREATED'
  | 'COLLECTION_UPDATED'
  | 'COLLECTION_DELETED'
  | 'COMPLETION_CHANGED'
  | 'EXCLUSION_CHANGED';
