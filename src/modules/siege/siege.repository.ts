import type Database from 'better-sqlite3';

import { withTransaction } from '../../infrastructure/db/transaction';
import type { UserRole } from '../auth/auth.types';
import type { SiegeActor, SiegeInput, SiegeRecord, StoredSiegeRecord } from './siege.types';

interface ActorRow {
  id: number;
  guild_id: number;
  role: UserRole;
  is_active: number;
}

interface SiegeRecordRow {
  user_id: number;
  nickname: string;
  main_class: string | null;
  combat_power: number | null;
  current_diamonds: number;
  remaining_diamonds: number;
  updated_at_ms: number | null;
}

interface StoredSiegeRecordRow {
  current_diamonds: number;
  remaining_diamonds: number;
}

export class SiegeRepository {
  public constructor(private readonly db: Database.Database) {}

  public findActor(userId: number, guildId: number): SiegeActor | null {
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

  public findRecords(guildId: number): SiegeRecord[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            u.id AS user_id,
            u.nickname,
            c.main_class,
            c.combat_power,
            COALESCE(sr.current_diamonds, 0) AS current_diamonds,
            COALESCE(sr.remaining_diamonds, 0) AS remaining_diamonds,
            CAST(strftime('%s', sr.updated_at) AS INTEGER) * 1000 AS updated_at_ms
          FROM users AS u
          LEFT JOIN characters AS c ON c.user_id = u.id
          LEFT JOIN siege_records AS sr
            ON sr.guild_id = u.guild_id AND sr.user_id = u.id
          WHERE u.guild_id = ? AND u.is_active = 1
          ORDER BY COALESCE(c.combat_power, 0) DESC, u.nickname ASC, u.id ASC
        `,
      )
      .all(guildId) as SiegeRecordRow[];

    return rows.map((row) => ({
      userId: row.user_id,
      nickname: row.nickname,
      mainClass: row.main_class ?? '',
      combatPower: row.combat_power ?? 0,
      currentDiamonds: row.current_diamonds,
      remainingDiamonds: row.remaining_diamonds,
      updatedAt: row.updated_at_ms,
    }));
  }

  public saveRecord(actor: SiegeActor, targetUserId: number, input: SiegeInput): void {
    withTransaction(this.db, () => {
      const previous = this.findStoredRecord(actor.guildId, targetUserId);
      this.db
        .prepare(
          `
            INSERT INTO siege_records (
              guild_id,
              user_id,
              current_diamonds,
              remaining_diamonds,
              updated_by
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(guild_id, user_id) DO UPDATE SET
              current_diamonds = excluded.current_diamonds,
              remaining_diamonds = excluded.remaining_diamonds,
              updated_by = excluded.updated_by,
              updated_at = CURRENT_TIMESTAMP
          `,
        )
        .run(actor.guildId, targetUserId, input.currentDiamonds, input.remainingDiamonds, actor.id);
      this.insertAudit(actor, targetUserId, 'RECORD_UPDATED', {
        previous,
        next: input,
      });
    });
  }

  public resetAll(actor: SiegeActor): number {
    return withTransaction(this.db, () => {
      const result = this.db
        .prepare('DELETE FROM siege_records WHERE guild_id = ?')
        .run(actor.guildId);
      const resetCount = result.changes;
      this.insertAudit(actor, null, 'ALL_RESET', { resetCount });
      return resetCount;
    });
  }

  private findStoredRecord(guildId: number, userId: number): StoredSiegeRecord | null {
    const row = this.db
      .prepare(
        `
          SELECT current_diamonds, remaining_diamonds
          FROM siege_records
          WHERE guild_id = ? AND user_id = ?
          LIMIT 1
        `,
      )
      .get(guildId, userId) as StoredSiegeRecordRow | undefined;
    return row
      ? {
          currentDiamonds: row.current_diamonds,
          remainingDiamonds: row.remaining_diamonds,
        }
      : null;
  }

  private insertAudit(
    actor: SiegeActor,
    targetUserId: number | null,
    action: 'RECORD_UPDATED' | 'ALL_RESET',
    metadata: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        `
          INSERT INTO siege_audit_logs (
            guild_id,
            actor_user_id,
            target_user_id,
            action,
            metadata_json
          )
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(actor.guildId, actor.id, targetUserId, action, JSON.stringify(metadata));
  }
}
