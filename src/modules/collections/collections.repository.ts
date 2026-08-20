import type Database from 'better-sqlite3';

import { withTransaction } from '../../infrastructure/db/transaction';
import type { UserRole } from '../auth/auth.types';
import type {
  CollectionActor,
  CollectionAuditAction,
  CollectionCompletion,
  CollectionCompletionLog,
  CollectionCompletionLogPage,
  CollectionInput,
  CollectionMutationStatus,
  ItemCollection,
} from './collections.types';

interface ActorRow {
  id: number;
  guild_id: number;
  username: string;
  role: UserRole;
  is_active: number;
}

interface CollectionRow {
  collection_id: number;
  guild_id: number;
  collection_name: string;
  item_id: number | null;
  part: string | null;
  enchantment: string | null;
  sort_order: number | null;
}

interface CompletionRow {
  user_id: number;
  collection_item_id: number;
}

interface CompletionLogRow {
  id: number;
  actor_user_id: number;
  actor_nickname: string | null;
  target_user_id: number;
  target_nickname: string | null;
  collection_id: number;
  collection_name: string;
  collection_item_id: number;
  part: string;
  enchantment: string;
  completed: number;
  created_at_ms: number;
}

export class CollectionsRepository {
  public constructor(private readonly db: Database.Database) {}

  public findActor(userId: number, guildId: number): CollectionActor | null {
    const row = this.db
      .prepare(
        `
          SELECT id, guild_id, username, role, is_active
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
      username: row.username,
      role: row.role,
      isActive: row.is_active === 1,
    };
  }

  public findCollections(guildId: number): ItemCollection[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            c.id AS collection_id,
            c.guild_id,
            c.name AS collection_name,
            ci.id AS item_id,
            ci.part,
            ci.enchantment,
            ci.sort_order
          FROM collections AS c
          LEFT JOIN collection_items AS ci ON ci.collection_id = c.id
          WHERE c.guild_id = ?
          ORDER BY c.id ASC, ci.sort_order ASC, ci.id ASC
        `,
      )
      .all(guildId) as CollectionRow[];

    const collections = new Map<number, ItemCollection>();
    rows.forEach((row) => {
      const collection = collections.get(row.collection_id) ?? {
        id: row.collection_id,
        guildId: row.guild_id,
        name: row.collection_name,
        items: [],
      };
      if (
        row.item_id !== null &&
        row.part !== null &&
        row.enchantment !== null &&
        row.sort_order !== null
      ) {
        collection.items.push({
          id: row.item_id,
          part: row.part,
          enchantment: row.enchantment,
          sortOrder: row.sort_order,
        });
      }
      collections.set(row.collection_id, collection);
    });
    return [...collections.values()];
  }

  public findCollection(guildId: number, collectionId: number): ItemCollection | null {
    return (
      this.findCollections(guildId).find((collection) => collection.id === collectionId) ?? null
    );
  }

  public collectionNameExists(
    guildId: number,
    name: string,
    excludingCollectionId?: number,
  ): boolean {
    const row = this.db
      .prepare(
        `
          SELECT 1 AS found
          FROM collections
          WHERE guild_id = ?
            AND name = ? COLLATE NOCASE
            AND (? IS NULL OR id <> ?)
          LIMIT 1
        `,
      )
      .get(guildId, name, excludingCollectionId ?? null, excludingCollectionId ?? null) as
      { found: number } | undefined;
    return row?.found === 1;
  }

  public createCollection(actor: CollectionActor, input: CollectionInput): number {
    return withTransaction(this.db, () => {
      const result = this.db
        .prepare('INSERT INTO collections (guild_id, name) VALUES (?, ?)')
        .run(actor.guildId, input.name);
      const collectionId = Number(result.lastInsertRowid);
      const insertItem = this.db.prepare(
        `
          INSERT INTO collection_items (collection_id, part, enchantment, sort_order)
          VALUES (?, ?, ?, ?)
        `,
      );
      input.items.forEach((item, index) => {
        insertItem.run(collectionId, item.part, item.enchantment, index);
      });
      this.insertAudit(actor, 'COLLECTION_CREATED', {
        collectionId,
        itemCount: input.items.length,
      });
      return collectionId;
    });
  }

  public updateCollection(
    actor: CollectionActor,
    current: ItemCollection,
    input: CollectionInput,
  ): void {
    withTransaction(this.db, () => {
      this.db
        .prepare(
          `
            UPDATE collections
            SET name = ?, updated_at = CURRENT_TIMESTAMP
            WHERE guild_id = ? AND id = ?
          `,
        )
        .run(input.name, actor.guildId, current.id);

      this.db
        .prepare(
          'UPDATE collection_items SET sort_order = sort_order + 1000000 WHERE collection_id = ?',
        )
        .run(current.id);

      const updateItem = this.db.prepare(
        `
          UPDATE collection_items
          SET part = ?, enchantment = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
          WHERE collection_id = ? AND id = ?
        `,
      );
      const insertItem = this.db.prepare(
        `
          INSERT INTO collection_items (collection_id, part, enchantment, sort_order)
          VALUES (?, ?, ?, ?)
        `,
      );
      input.items.forEach((item, index) => {
        if (item.id === undefined) {
          insertItem.run(current.id, item.part, item.enchantment, index);
        } else {
          updateItem.run(item.part, item.enchantment, index, current.id, item.id);
        }
      });

      const retainedIds = new Set(
        input.items.flatMap((item) => (item.id === undefined ? [] : [item.id])),
      );
      const removedIds = current.items
        .map((item) => item.id)
        .filter((itemId) => !retainedIds.has(itemId));
      const deleteItem = this.db.prepare(
        'DELETE FROM collection_items WHERE collection_id = ? AND id = ?',
      );
      removedIds.forEach((itemId) => deleteItem.run(current.id, itemId));

      this.insertAudit(actor, 'COLLECTION_UPDATED', {
        collectionId: current.id,
        itemCount: input.items.length,
        removedItemIds: removedIds,
      });
    });
  }

  public deleteCollection(actor: CollectionActor, collection: ItemCollection): void {
    withTransaction(this.db, () => {
      this.insertAudit(actor, 'COLLECTION_DELETED', {
        collectionId: collection.id,
        itemCount: collection.items.length,
      });
      this.db
        .prepare('DELETE FROM collections WHERE guild_id = ? AND id = ?')
        .run(actor.guildId, collection.id);
    });
  }

  public findCompletions(guildId: number): CollectionCompletion[] {
    const rows = this.db
      .prepare(
        `
          SELECT uci.user_id, uci.collection_item_id
          FROM user_collection_items AS uci
          JOIN users AS u ON u.id = uci.user_id
          JOIN collection_items AS ci ON ci.id = uci.collection_item_id
          JOIN collections AS c ON c.id = ci.collection_id
          WHERE uci.guild_id = ?
            AND u.guild_id = ?
            AND u.is_active = 1
            AND c.guild_id = ?
          ORDER BY uci.user_id ASC, uci.collection_item_id ASC
        `,
      )
      .all(guildId, guildId, guildId) as CompletionRow[];
    return rows.map((row) => ({
      userId: row.user_id,
      collectionItemId: row.collection_item_id,
    }));
  }

  public findCompletionLogs(
    guildId: number,
    cursor: number | undefined,
    limit: number,
    targetUserId?: number,
  ): CollectionCompletionLogPage {
    const rows = this.db
      .prepare(
        `
          SELECT
            cal.id,
            cal.actor_user_id,
            actor.nickname AS actor_nickname,
            CAST(json_extract(cal.metadata_json, '$.userId') AS INTEGER) AS target_user_id,
            target.nickname AS target_nickname,
            c.id AS collection_id,
            c.name AS collection_name,
            ci.id AS collection_item_id,
            ci.part,
            ci.enchantment,
            CAST(json_extract(cal.metadata_json, '$.completed') AS INTEGER) AS completed,
            CAST(strftime('%s', cal.created_at) AS INTEGER) * 1000 AS created_at_ms
          FROM collection_audit_logs AS cal
          JOIN collection_items AS ci ON ci.id = cal.collection_item_id
          JOIN collections AS c ON c.id = ci.collection_id AND c.guild_id = cal.guild_id
          LEFT JOIN users AS actor
            ON actor.id = cal.actor_user_id AND actor.guild_id = cal.guild_id
          LEFT JOIN users AS target
            ON target.id = CAST(json_extract(cal.metadata_json, '$.userId') AS INTEGER)
            AND target.guild_id = cal.guild_id
          WHERE cal.guild_id = ?
            AND cal.action = 'COMPLETION_CHANGED'
            AND (? IS NULL OR cal.id < ?)
            AND (
              ? IS NULL
              OR CAST(json_extract(cal.metadata_json, '$.userId') AS INTEGER) = ?
            )
          ORDER BY cal.id DESC
          LIMIT ?
        `,
      )
      .all(
        guildId,
        cursor ?? null,
        cursor ?? null,
        targetUserId ?? null,
        targetUserId ?? null,
        limit + 1,
      ) as CompletionLogRow[];

    const hasNextPage = rows.length > limit;
    const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
    const items: CollectionCompletionLog[] = pageRows.map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      actorNickname: row.actor_nickname,
      targetUserId: row.target_user_id,
      targetNickname: row.target_nickname,
      collectionId: row.collection_id,
      collectionName: row.collection_name,
      collectionItemId: row.collection_item_id,
      part: row.part,
      enchantment: row.enchantment,
      completed: row.completed === 1,
      createdAt: row.created_at_ms,
    }));

    return {
      items,
      nextCursor: hasNextPage ? (items.at(-1)?.id ?? null) : null,
    };
  }

  public activeUserExists(guildId: number, userId: number): boolean {
    const row = this.db
      .prepare(
        `
          SELECT 1 AS found
          FROM users
          WHERE guild_id = ? AND id = ? AND is_active = 1
          LIMIT 1
        `,
      )
      .get(guildId, userId) as { found: number } | undefined;
    return row?.found === 1;
  }

  public collectionItemExists(guildId: number, itemId: number): boolean {
    const row = this.db
      .prepare(
        `
          SELECT 1 AS found
          FROM collection_items AS ci
          JOIN collections AS c ON c.id = ci.collection_id
          WHERE c.guild_id = ? AND ci.id = ?
          LIMIT 1
        `,
      )
      .get(guildId, itemId) as { found: number } | undefined;
    return row?.found === 1;
  }

  public setCompletion(
    actor: CollectionActor,
    userId: number,
    itemId: number,
    completed: boolean,
  ): CollectionMutationStatus {
    return withTransaction(this.db, () => {
      const existing = this.db
        .prepare(
          `
            SELECT 1 AS found
            FROM user_collection_items
            WHERE guild_id = ? AND user_id = ? AND collection_item_id = ?
            LIMIT 1
          `,
        )
        .get(actor.guildId, userId, itemId) as { found: number } | undefined;
      const wasCompleted = existing?.found === 1;
      if (completed && !wasCompleted) {
        this.db
          .prepare(
            `
              INSERT INTO user_collection_items (guild_id, user_id, collection_item_id)
              VALUES (?, ?, ?)
            `,
          )
          .run(actor.guildId, userId, itemId);
      } else if (!completed && wasCompleted) {
        this.db
          .prepare(
            `
              DELETE FROM user_collection_items
              WHERE guild_id = ? AND user_id = ? AND collection_item_id = ?
            `,
          )
          .run(actor.guildId, userId, itemId);
      }
      if (wasCompleted !== completed) {
        this.insertAudit(
          actor,
          'COMPLETION_CHANGED',
          {
            userId,
            collectionItemId: itemId,
            completed,
          },
          itemId,
        );
      }
      return completed ? 'added' : 'removed';
    });
  }

  public findExcludedMemberIds(guildId: number): number[] {
    const rows = this.db
      .prepare(
        `
          SELECT em.user_id
          FROM excluded_members AS em
          JOIN users AS u ON u.id = em.user_id
          WHERE em.guild_id = ? AND u.guild_id = ? AND u.is_active = 1
          ORDER BY em.user_id ASC
        `,
      )
      .all(guildId, guildId) as Array<{ user_id: number }>;
    return rows.map((row) => row.user_id);
  }

  public toggleExcluded(actor: CollectionActor, userId: number): CollectionMutationStatus {
    return withTransaction(this.db, () => {
      const existing = this.db
        .prepare('SELECT 1 AS found FROM excluded_members WHERE guild_id = ? AND user_id = ?')
        .get(actor.guildId, userId) as { found: number } | undefined;
      const status: CollectionMutationStatus = existing ? 'removed' : 'added';
      if (existing) {
        this.db
          .prepare('DELETE FROM excluded_members WHERE guild_id = ? AND user_id = ?')
          .run(actor.guildId, userId);
      } else {
        this.db
          .prepare('INSERT INTO excluded_members (guild_id, user_id) VALUES (?, ?)')
          .run(actor.guildId, userId);
      }
      this.insertAudit(actor, 'EXCLUSION_CHANGED', {
        userId,
        excluded: status === 'added',
      });
      return status;
    });
  }

  private insertAudit(
    actor: CollectionActor,
    action: CollectionAuditAction,
    metadata: Record<string, unknown>,
    collectionItemId?: number,
  ): void {
    this.db
      .prepare(
        `
          INSERT INTO collection_audit_logs (
            guild_id,
            actor_user_id,
            collection_item_id,
            action,
            metadata_json
          )
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(actor.guildId, actor.id, collectionItemId ?? null, action, JSON.stringify(metadata));
  }
}
