import type { UserRole } from '../auth/auth.types';

export type NoticeArticleType = 'RULE' | 'PRICE_GUIDE';
export type BossControlStatus = 'NONE' | 'ALLY_ONLY' | 'CONTROL';

export interface NoticeActor {
  id: number;
  guildId: number;
  role: UserRole;
  isActive: boolean;
}

export interface NoticeArticle {
  id: number;
  guildId: number;
  title: string;
  content: string;
  color: string;
  sortOrder: number;
  updatedAt: number;
}

export interface NoticeArticleInput {
  title: string;
  content: string;
  color: string;
}

export interface BossControl {
  name: string;
  status: BossControlStatus;
}

export interface BossControlChapter {
  chapter: string;
  bosses: BossControl[];
}

export interface BossControlUpdate {
  chapter: string;
  boss: string;
  status: BossControlStatus;
}

export type NoticeAuditAction =
  | 'ARTICLE_CREATED'
  | 'ARTICLE_UPDATED'
  | 'ARTICLE_DELETED'
  | 'RULES_REORDERED'
  | 'BOSS_CONTROL_UPDATED';
