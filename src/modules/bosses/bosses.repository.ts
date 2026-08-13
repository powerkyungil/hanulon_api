import type Database from 'better-sqlite3';

import { withTransaction } from '../../infrastructure/db/transaction';
import type { UserRole } from '../auth/auth.types';
import { DEFAULT_BOSS_DEFINITIONS } from './bosses.constants';
import type { BossActor, BossDefinition, BossDefinitionInput, BossKey } from './bosses.types';

interface ActorRow {
  id: number;
  guild_id: number;
  role: UserRole;
  is_active: number;
}

interface BossRow {
  id: number;
  guild_id: number;
  type: string;
  region: string;
  boss: string;
  cooldown_hours: number;
  time_text: string | null;
  days: string | null;
  color: string | null;
  sort_order: number;
}

const mapBoss = (row: BossRow): BossDefinition => ({
  id: row.id,
  guildId: row.guild_id,
  type: row.type,
  region: row.region,
  boss: row.boss,
  cooldownHours: row.cooldown_hours,
  timeText: row.time_text,
  days: row.days,
  color: row.color,
  sortOrder: row.sort_order,
});

export class BossesRepository {
  public constructor(private readonly db: Database.Database) {}

  public findActor(userId: number, guildId: number): BossActor | null {
    const row = this.db
      .prepare('SELECT id, guild_id, role, is_active FROM users WHERE id = ? AND guild_id = ?')
      .get(userId, guildId) as ActorRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      guildId: row.guild_id,
      role: row.role,
      isActive: row.is_active === 1,
    };
  }

  public ensureDefaults(guildId: number): void {
    const seeded = this.db
      .prepare('SELECT 1 AS found FROM boss_definition_seed_state WHERE guild_id = ?')
      .get(guildId) as { found: number } | undefined;
    if (seeded) return;

    withTransaction(this.db, () => {
      const marker = this.db
        .prepare('INSERT OR IGNORE INTO boss_definition_seed_state (guild_id) VALUES (?)')
        .run(guildId);
      if (marker.changes === 0) return;
      this.insertDefaults(guildId);
    });
  }

  public findAll(guildId: number): BossDefinition[] {
    const rows = this.db
      .prepare(
        `
          SELECT id, guild_id, type, region, boss, cooldown_hours, time_text, days, color, sort_order
          FROM boss_definitions
          WHERE guild_id = ?
          ORDER BY sort_order ASC, id ASC
        `,
      )
      .all(guildId) as BossRow[];
    return rows.map(mapBoss);
  }

  public findById(guildId: number, id: number): BossDefinition | null {
    const row = this.db
      .prepare(
        `
          SELECT id, guild_id, type, region, boss, cooldown_hours, time_text, days, color, sort_order
          FROM boss_definitions
          WHERE guild_id = ? AND id = ?
        `,
      )
      .get(guildId, id) as BossRow | undefined;
    return row ? mapBoss(row) : null;
  }

  public findByKey(guildId: number, key: BossKey): BossDefinition | null {
    return this.findAllByKey(guildId, key)[0] ?? null;
  }

  public findAllByKey(guildId: number, key: BossKey): BossDefinition[] {
    const rows = this.db
      .prepare(
        `
          SELECT id, guild_id, type, region, boss, cooldown_hours, time_text, days, color, sort_order
          FROM boss_definitions
          WHERE guild_id = ? AND type = ? AND region = ? AND boss = ?
          ORDER BY id ASC
        `,
      )
      .all(guildId, key.type, key.region, key.boss) as BossRow[];
    return rows.map(mapBoss);
  }

  public exactDefinitionExists(guildId: number, input: BossDefinitionInput): boolean {
    const row = this.db
      .prepare(
        `
          SELECT 1 AS found
          FROM boss_definitions
          WHERE guild_id = ?
            AND type = ?
            AND region = ?
            AND boss = ?
            AND COALESCE(time_text, '') = COALESCE(?, '')
          LIMIT 1
        `,
      )
      .get(guildId, input.type, input.region, input.boss, input.timeText) as
      { found: number } | undefined;
    return row?.found === 1;
  }

  public create(actor: BossActor, input: BossDefinitionInput): number {
    return withTransaction(this.db, () => {
      const nextOrder = (
        this.db
          .prepare(
            'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM boss_definitions WHERE guild_id = ?',
          )
          .get(actor.guildId) as { next_order: number }
      ).next_order;
      const result = this.db
        .prepare(
          `
            INSERT INTO boss_definitions (
              guild_id, type, region, boss, cooldown_hours, time_text, days, color, sort_order
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          actor.guildId,
          input.type,
          input.region,
          input.boss,
          input.cooldownHours,
          input.timeText,
          input.days,
          input.color,
          nextOrder,
        );
      const id = Number(result.lastInsertRowid);
      this.insertAudit(actor, id, 'BOSS_CREATED', { ...input });
      return id;
    });
  }

  public delete(actor: BossActor, definition: BossDefinition): void {
    withTransaction(this.db, () => {
      this.insertAudit(actor, definition.id, 'BOSS_DELETED', {
        type: definition.type,
        region: definition.region,
        boss: definition.boss,
      });
      this.db
        .prepare('DELETE FROM boss_definitions WHERE guild_id = ? AND id = ?')
        .run(actor.guildId, definition.id);
    });
  }

  public reorderByIds(actor: BossActor, ids: number[]): void {
    withTransaction(this.db, () => {
      const update = this.db.prepare(
        'UPDATE boss_definitions SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND id = ?',
      );
      ids.forEach((id, index) => update.run(index, actor.guildId, id));
      this.insertAudit(actor, null, 'BOSSES_REORDERED', { ids });
    });
  }

  public reorderByBossNames(
    actor: BossActor,
    orderList: Array<{ boss: string; sortOrder: number }>,
  ): void {
    withTransaction(this.db, () => {
      const update = this.db.prepare(
        'UPDATE boss_definitions SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND boss = ?',
      );
      orderList.forEach((item) => update.run(item.sortOrder, actor.guildId, item.boss));
      this.insertAudit(actor, null, 'BOSSES_REORDERED', { orderList });
    });
  }

  public reset(actor: BossActor): void {
    withTransaction(this.db, () => {
      const removed = this.db
        .prepare('DELETE FROM boss_definitions WHERE guild_id = ?')
        .run(actor.guildId).changes;
      this.insertDefaults(actor.guildId);
      this.insertAudit(actor, null, 'BOSSES_RESET', {
        removedCount: removed,
        insertedCount: DEFAULT_BOSS_DEFINITIONS.length,
      });
    });
  }

  private insertDefaults(guildId: number): void {
    const insert = this.db.prepare(
      `
        INSERT INTO boss_definitions (
          guild_id, type, region, boss, cooldown_hours, time_text, days, color, sort_order
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );
    DEFAULT_BOSS_DEFINITIONS.forEach((definition, index) =>
      insert.run(
        guildId,
        definition.type,
        definition.region,
        definition.boss,
        definition.cooldownHours,
        definition.timeText,
        definition.days,
        definition.color,
        index,
      ),
    );
  }

  private insertAudit(
    actor: BossActor,
    definitionId: number | null,
    action: 'BOSS_CREATED' | 'BOSS_DELETED' | 'BOSSES_REORDERED' | 'BOSSES_RESET',
    metadata: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        `
          INSERT INTO boss_audit_logs (
            guild_id, actor_user_id, boss_definition_id, action, metadata_json
          )
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(actor.guildId, actor.id, definitionId, action, JSON.stringify(metadata));
  }
}
