import type Database from 'better-sqlite3';

import { withTransaction } from '../../infrastructure/db/transaction';
import type { UserRole } from '../auth/auth.types';
import type {
  ContentGroup,
  ContentGroupActor,
  ContentGroupAuditAction,
} from './content-groups.types';

interface ActorRow {
  id: number;
  guild_id: number;
  role: UserRole;
  is_active: number;
}

interface GroupRow {
  id: number;
  guild_id: number;
  name: string;
  user_id: number | null;
}

export class ContentGroupsRepository {
  public constructor(private readonly db: Database.Database) {}

  public findActor(userId: number, guildId: number): ContentGroupActor | null {
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

  public findGroups(guildId: number): ContentGroup[] {
    const rows = this.db
      .prepare(
        `
          SELECT cg.id, cg.guild_id, cg.name, gm.user_id
          FROM content_groups AS cg
          LEFT JOIN group_members AS gm ON gm.group_id = cg.id
          WHERE cg.guild_id = ?
          ORDER BY cg.id ASC, gm.sort_order ASC, gm.user_id ASC
        `,
      )
      .all(guildId) as GroupRow[];

    const groups = new Map<number, ContentGroup>();
    rows.forEach((row) => {
      const group = groups.get(row.id) ?? {
        id: row.id,
        guildId: row.guild_id,
        name: row.name,
        memberIds: [],
      };
      if (row.user_id !== null) group.memberIds.push(row.user_id);
      groups.set(row.id, group);
    });
    return [...groups.values()];
  }

  public findGroup(guildId: number, groupId: number): ContentGroup | null {
    return this.findGroups(guildId).find((group) => group.id === groupId) ?? null;
  }

  public groupNameExists(guildId: number, name: string, excludingGroupId?: number): boolean {
    const row = this.db
      .prepare(
        `
          SELECT 1 AS found
          FROM content_groups
          WHERE guild_id = ?
            AND name = ? COLLATE NOCASE
            AND (? IS NULL OR id <> ?)
          LIMIT 1
        `,
      )
      .get(guildId, name, excludingGroupId ?? null, excludingGroupId ?? null) as
      { found: number } | undefined;
    return row?.found === 1;
  }

  public findInvalidActiveUserIds(guildId: number, userIds: number[]): number[] {
    if (userIds.length === 0) return [];
    const placeholders = userIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `
          SELECT id
          FROM users
          WHERE guild_id = ? AND is_active = 1 AND id IN (${placeholders})
        `,
      )
      .all(guildId, ...userIds) as Array<{ id: number }>;
    const validIds = new Set(rows.map((row) => row.id));
    return userIds.filter((userId) => !validIds.has(userId));
  }

  public findMembersAssignedToOtherGroups(groupId: number, userIds: number[]): number[] {
    if (userIds.length === 0) return [];
    const placeholders = userIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `
          SELECT user_id
          FROM group_members
          WHERE group_id <> ? AND user_id IN (${placeholders})
          ORDER BY user_id ASC
        `,
      )
      .all(groupId, ...userIds) as Array<{ user_id: number }>;
    return rows.map((row) => row.user_id);
  }

  public createGroup(actor: ContentGroupActor, name: string): number {
    return withTransaction(this.db, () => {
      const result = this.db
        .prepare('INSERT INTO content_groups (guild_id, name) VALUES (?, ?)')
        .run(actor.guildId, name);
      const groupId = Number(result.lastInsertRowid);
      this.insertAudit(actor, groupId, 'GROUP_CREATED', { name });
      return groupId;
    });
  }

  public renameGroup(actor: ContentGroupActor, group: ContentGroup, name: string): void {
    withTransaction(this.db, () => {
      this.db
        .prepare(
          `
            UPDATE content_groups
            SET name = ?, updated_at = CURRENT_TIMESTAMP
            WHERE guild_id = ? AND id = ?
          `,
        )
        .run(name, actor.guildId, group.id);
      this.insertAudit(actor, group.id, 'GROUP_RENAMED', {
        previousName: group.name,
        nextName: name,
      });
    });
  }

  public deleteGroup(actor: ContentGroupActor, group: ContentGroup): void {
    withTransaction(this.db, () => {
      this.insertAudit(actor, group.id, 'GROUP_DELETED', {
        name: group.name,
        previousMemberIds: group.memberIds,
      });
      this.db
        .prepare('DELETE FROM content_groups WHERE guild_id = ? AND id = ?')
        .run(actor.guildId, group.id);
    });
  }

  public replaceMembers(actor: ContentGroupActor, group: ContentGroup, userIds: number[]): void {
    withTransaction(this.db, () => {
      const invalidUserIds = this.findInvalidActiveUserIds(actor.guildId, userIds);
      if (invalidUserIds.length > 0) {
        throw new Error(`CONTENT_GROUP_MEMBER_INVALID:${invalidUserIds.join(',')}`);
      }
      const assignedUserIds = this.findMembersAssignedToOtherGroups(group.id, userIds);
      if (assignedUserIds.length > 0) {
        throw new Error(`CONTENT_GROUP_MEMBER_ALREADY_ASSIGNED:${assignedUserIds.join(',')}`);
      }
      this.db.prepare('DELETE FROM group_members WHERE group_id = ?').run(group.id);
      const insert = this.db.prepare(
        `
          INSERT INTO group_members (group_id, user_id, sort_order)
          VALUES (?, ?, ?)
        `,
      );
      userIds.forEach((userId, index) => insert.run(group.id, userId, index));
      this.db
        .prepare(
          'UPDATE content_groups SET updated_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND id = ?',
        )
        .run(actor.guildId, group.id);
      this.insertAudit(actor, group.id, 'MEMBERS_REPLACED', {
        previousMemberIds: group.memberIds,
        nextMemberIds: userIds,
      });
    });
  }

  private insertAudit(
    actor: ContentGroupActor,
    groupId: number,
    action: ContentGroupAuditAction,
    metadata: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        `
          INSERT INTO content_group_audit_logs (
            guild_id,
            actor_user_id,
            group_id,
            action,
            metadata_json
          )
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(actor.guildId, actor.id, groupId, action, JSON.stringify(metadata));
  }
}
