import type Database from 'better-sqlite3';

import { withTransaction } from '../../infrastructure/db/transaction';
import type { UserRole } from '../auth/auth.types';
import type {
  BossControlStatus,
  BossControlUpdate,
  NoticeActor,
  NoticeArticle,
  NoticeArticleInput,
  NoticeArticleType,
  NoticeAuditAction,
} from './notices.types';

interface ActorRow {
  id: number;
  guild_id: number;
  role: UserRole;
  is_active: number;
}

interface ArticleRow {
  id: number;
  guild_id: number;
  title: string;
  content: string;
  color: string;
  sort_order: number;
  updated_at_ms: number;
}

interface BossControlRow {
  chapter: string;
  boss: string;
  status: BossControlStatus;
}

const articleTable = (type: NoticeArticleType): 'notice_rules' | 'price_guides' =>
  type === 'RULE' ? 'notice_rules' : 'price_guides';

const mapArticle = (row: ArticleRow): NoticeArticle => ({
  id: row.id,
  guildId: row.guild_id,
  title: row.title,
  content: row.content,
  color: row.color,
  sortOrder: row.sort_order,
  updatedAt: row.updated_at_ms,
});

export class NoticesRepository {
  public constructor(private readonly db: Database.Database) {}

  public findActor(userId: number, guildId: number): NoticeActor | null {
    const row = this.db
      .prepare(
        `
          SELECT id, guild_id, role, is_active
          FROM users
          WHERE id = ? AND guild_id = ?
          LIMIT 1
        `,
      )
      .get(userId, guildId) as ActorRow | undefined;

    if (!row) return null;
    return {
      id: row.id,
      guildId: row.guild_id,
      role: row.role,
      isActive: row.is_active === 1,
    };
  }

  public findArticles(guildId: number, type: NoticeArticleType): NoticeArticle[] {
    const table = articleTable(type);
    const sort = type === 'RULE' ? 'sort_order ASC, id ASC' : 'updated_at DESC, id DESC';
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            guild_id,
            title,
            content,
            color,
            ${type === 'RULE' ? 'sort_order' : '0'} AS sort_order,
            CAST(strftime('%s', updated_at) AS INTEGER) * 1000 AS updated_at_ms
          FROM ${table}
          WHERE guild_id = ?
          ORDER BY ${sort}
        `,
      )
      .all(guildId) as ArticleRow[];
    return rows.map(mapArticle);
  }

  public findArticle(
    guildId: number,
    type: NoticeArticleType,
    articleId: number,
  ): NoticeArticle | null {
    const table = articleTable(type);
    const row = this.db
      .prepare(
        `
          SELECT
            id,
            guild_id,
            title,
            content,
            color,
            ${type === 'RULE' ? 'sort_order' : '0'} AS sort_order,
            CAST(strftime('%s', updated_at) AS INTEGER) * 1000 AS updated_at_ms
          FROM ${table}
          WHERE guild_id = ? AND id = ?
          LIMIT 1
        `,
      )
      .get(guildId, articleId) as ArticleRow | undefined;
    return row ? mapArticle(row) : null;
  }

  public createArticle(
    actor: NoticeActor,
    type: NoticeArticleType,
    input: NoticeArticleInput,
  ): number {
    return withTransaction(this.db, () => {
      const result =
        type === 'RULE'
          ? this.db
              .prepare(
                `
                  INSERT INTO notice_rules (
                    guild_id,
                    title,
                    content,
                    color,
                    sort_order,
                    created_by
                  )
                  VALUES (
                    ?,
                    ?,
                    ?,
                    ?,
                    (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM notice_rules WHERE guild_id = ?),
                    ?
                  )
                `,
              )
              .run(actor.guildId, input.title, input.content, input.color, actor.guildId, actor.id)
          : this.db
              .prepare(
                `
                  INSERT INTO price_guides (guild_id, title, content, color, created_by)
                  VALUES (?, ?, ?, ?, ?)
                `,
              )
              .run(actor.guildId, input.title, input.content, input.color, actor.id);
      const articleId = Number(result.lastInsertRowid);
      this.insertAudit(actor, 'ARTICLE_CREATED', { articleId, articleType: type });
      return articleId;
    });
  }

  public updateArticle(
    actor: NoticeActor,
    type: NoticeArticleType,
    articleId: number,
    input: NoticeArticleInput,
  ): void {
    withTransaction(this.db, () => {
      const table = articleTable(type);
      this.db
        .prepare(
          `
            UPDATE ${table}
            SET title = ?, content = ?, color = ?, updated_at = CURRENT_TIMESTAMP
            WHERE guild_id = ? AND id = ?
          `,
        )
        .run(input.title, input.content, input.color, actor.guildId, articleId);
      this.insertAudit(actor, 'ARTICLE_UPDATED', { articleId, articleType: type });
    });
  }

  public deleteArticle(actor: NoticeActor, type: NoticeArticleType, articleId: number): void {
    withTransaction(this.db, () => {
      const table = articleTable(type);
      this.db
        .prepare(`DELETE FROM ${table} WHERE guild_id = ? AND id = ?`)
        .run(actor.guildId, articleId);
      if (type === 'RULE') this.compactRuleOrder(actor.guildId);
      this.insertAudit(actor, 'ARTICLE_DELETED', { articleId, articleType: type });
    });
  }

  public findRuleIds(guildId: number): number[] {
    const rows = this.db
      .prepare('SELECT id FROM notice_rules WHERE guild_id = ? ORDER BY sort_order ASC, id ASC')
      .all(guildId) as Array<{ id: number }>;
    return rows.map((row) => row.id);
  }

  public reorderRules(actor: NoticeActor, ids: number[]): void {
    withTransaction(this.db, () => {
      const update = this.db.prepare(
        'UPDATE notice_rules SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND id = ?',
      );
      ids.forEach((id, index) => update.run(index, actor.guildId, id));
      this.insertAudit(actor, 'RULES_REORDERED', { ids });
    });
  }

  public findBossControls(guildId: number): BossControlRow[] {
    return this.db
      .prepare(
        `
          SELECT chapter, boss, status
          FROM boss_controls
          WHERE guild_id = ?
        `,
      )
      .all(guildId) as BossControlRow[];
  }

  public updateBossControl(actor: NoticeActor, input: BossControlUpdate): void {
    withTransaction(this.db, () => {
      this.db
        .prepare(
          `
            INSERT INTO boss_controls (guild_id, chapter, boss, status, updated_by)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(guild_id, chapter, boss) DO UPDATE SET
              status = excluded.status,
              updated_by = excluded.updated_by,
              updated_at = CURRENT_TIMESTAMP
          `,
        )
        .run(actor.guildId, input.chapter, input.boss, input.status, actor.id);
      this.insertAudit(actor, 'BOSS_CONTROL_UPDATED', {
        chapter: input.chapter,
        boss: input.boss,
        status: input.status,
      });
    });
  }

  private compactRuleOrder(guildId: number): void {
    const rows = this.db
      .prepare('SELECT id FROM notice_rules WHERE guild_id = ? ORDER BY sort_order ASC, id ASC')
      .all(guildId) as Array<{ id: number }>;
    const update = this.db.prepare(
      'UPDATE notice_rules SET sort_order = ? WHERE guild_id = ? AND id = ?',
    );
    rows.forEach((row, index) => update.run(index, guildId, row.id));
  }

  private insertAudit(
    actor: NoticeActor,
    action: NoticeAuditAction,
    metadata: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        `
          INSERT INTO notice_audit_logs (guild_id, actor_user_id, action, metadata_json)
          VALUES (?, ?, ?, ?)
        `,
      )
      .run(actor.guildId, actor.id, action, JSON.stringify(metadata));
  }
}
