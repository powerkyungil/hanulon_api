import type { UserRole } from '../auth/auth.types';

export interface CollectionActor {
  id: number;
  guildId: number;
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

export type CollectionMutationStatus = 'added' | 'removed';

export type CollectionAuditAction =
  | 'COLLECTION_CREATED'
  | 'COLLECTION_UPDATED'
  | 'COLLECTION_DELETED'
  | 'COMPLETION_CHANGED'
  | 'EXCLUSION_CHANGED';
