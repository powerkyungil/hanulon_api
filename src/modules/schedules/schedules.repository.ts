import type Database from 'better-sqlite3';

import { withTransaction } from '../../infrastructure/db/transaction';
import type { UserRole } from '../auth/auth.types';
import type {
  BossSchedule,
  ResolvedScheduleInput,
  ScheduleActor,
  VoteOccurrence,
} from './schedules.types';

interface ActorRow {
  id: number;
  guild_id: number;
  role: UserRole;
  nickname: string;
  is_active: number;
}

interface ScheduleRow {
  id: number;
  boss_definition_id: number;
  type: string;
  region: string;
  boss: string;
  spawn_time: number;
  is_mung: number;
}

const mapSchedule = (row: ScheduleRow): BossSchedule => ({
  id: row.id,
  bossDefinitionId: row.boss_definition_id,
  type: row.type,
  region: row.region,
  boss: row.boss,
  spawnTime: row.spawn_time,
  isMung: row.is_mung === 1,
});

export class SchedulesRepository {
  public constructor(private readonly db: Database.Database) {}

  public findActor(userId: number, guildId: number): ScheduleActor | null {
    const row = this.db
      .prepare(
        'SELECT id, guild_id, role, nickname, is_active FROM users WHERE id = ? AND guild_id = ?',
      )
      .get(userId, guildId) as ActorRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      guildId: row.guild_id,
      role: row.role,
      nickname: row.nickname,
      isActive: row.is_active === 1,
    };
  }

  public findAll(guildId: number): BossSchedule[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            bs.id,
            bs.boss_definition_id,
            bd.type,
            bd.region,
            bd.boss,
            bs.spawn_time,
            bs.is_mung
          FROM boss_schedules AS bs
          JOIN boss_definitions AS bd
            ON bd.id = bs.boss_definition_id AND bd.guild_id = bs.guild_id
          WHERE bs.guild_id = ?
          ORDER BY bs.spawn_time ASC, bs.id ASC
        `,
      )
      .all(guildId) as ScheduleRow[];
    return rows.map(mapSchedule);
  }

  public findById(guildId: number, scheduleId: number): BossSchedule | null {
    return this.findAll(guildId).find((schedule) => schedule.id === scheduleId) ?? null;
  }

  public findByDefinition(guildId: number, definitionId: number): BossSchedule | null {
    return (
      this.findAll(guildId).find((schedule) => schedule.bossDefinitionId === definitionId) ?? null
    );
  }

  public findHistory(
    guildId: number,
    startMs: number,
    endMs: number,
    targetBossDefinitionIds: number[],
  ): VoteOccurrence[] {
    if (targetBossDefinitionIds.length === 0) return [];
    const placeholders = targetBossDefinitionIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `
          SELECT type, region, boss, spawn_time
          FROM schedule_history
          WHERE guild_id = ?
            AND spawn_time BETWEEN ? AND ?
            AND boss_definition_id IN (${placeholders})
          ORDER BY spawn_time ASC, id ASC
        `,
      )
      .all(guildId, startMs, endMs, ...targetBossDefinitionIds) as Array<{
      type: string;
      region: string;
      boss: string;
      spawn_time: number;
    }>;
    return rows.map((row) => ({
      id: null,
      type: row.type,
      region: row.region,
      boss: row.boss,
      spawnTime: row.spawn_time,
      isFixed: false,
      isHistory: true,
    }));
  }

  public saveMany(actor: ScheduleActor, inputs: ResolvedScheduleInput[]): void {
    withTransaction(this.db, () => {
      inputs.forEach((input) => this.replaceCurrent(actor, input, false));
      this.insertAudit(actor, null, 'SCHEDULES_SAVED', {
        count: inputs.length,
        schedules: inputs.map(({ type, region, boss, spawnTime }) => ({
          type,
          region,
          boss,
          spawnTime,
        })),
      });
    });
  }

  public replaceForAction(
    actor: ScheduleActor,
    input: ResolvedScheduleInput,
    isMung: boolean,
    action: 'SCHEDULE_CUT' | 'SCHEDULE_MUNG',
  ): number {
    return withTransaction(this.db, () => {
      const scheduleId = this.replaceCurrent(actor, input, isMung);
      this.insertAudit(actor, scheduleId, action, {
        type: input.type,
        region: input.region,
        boss: input.boss,
        spawnTime: input.spawnTime,
      });
      return scheduleId;
    });
  }

  public delete(actor: ScheduleActor, schedule: BossSchedule): void {
    withTransaction(this.db, () => {
      this.db
        .prepare('DELETE FROM boss_schedules WHERE guild_id = ? AND id = ?')
        .run(actor.guildId, schedule.id);
      this.insertAudit(actor, schedule.id, 'SCHEDULE_DELETED', {
        type: schedule.type,
        region: schedule.region,
        boss: schedule.boss,
        spawnTime: schedule.spawnTime,
      });
    });
  }

  public resetAll(actor: ScheduleActor): number {
    return withTransaction(this.db, () => {
      const removed = this.db
        .prepare('DELETE FROM boss_schedules WHERE guild_id = ?')
        .run(actor.guildId).changes;
      this.insertAudit(actor, null, 'SCHEDULES_RESET', { removedCount: removed });
      return removed;
    });
  }

  public findTargetDefinitionIds(guildId: number): number[] {
    return (
      this.db
        .prepare(
          'SELECT boss_definition_id FROM participation_targets WHERE guild_id = ? ORDER BY boss_definition_id ASC',
        )
        .all(guildId) as Array<{ boss_definition_id: number }>
    ).map((row) => row.boss_definition_id);
  }

  public replaceTargetDefinitionIds(actor: ScheduleActor, bossDefinitionIds: number[]): void {
    withTransaction(this.db, () => {
      const previous = this.findTargetDefinitionIds(actor.guildId);
      this.db.prepare('DELETE FROM participation_targets WHERE guild_id = ?').run(actor.guildId);
      const insert = this.db.prepare(
        'INSERT INTO participation_targets (guild_id, boss_definition_id) VALUES (?, ?)',
      );
      bossDefinitionIds.forEach((id) => insert.run(actor.guildId, id));
      this.insertAudit(actor, null, 'TARGETS_CHANGED', { previous, next: bossDefinitionIds });
    });
  }

  public findParticipants(guildId: number, cutoff: number): Record<string, string[]> {
    const rows = this.db
      .prepare(
        `
          SELECT vote_key, nickname_snapshot
          FROM boss_participants
          WHERE guild_id = ? AND spawn_time >= ?
          ORDER BY created_at ASC, user_id ASC
        `,
      )
      .all(guildId, cutoff) as Array<{ vote_key: string; nickname_snapshot: string }>;
    const result: Record<string, string[]> = {};
    rows.forEach((row) => {
      (result[row.vote_key] ??= []).push(row.nickname_snapshot);
    });
    return result;
  }

  public findClosedVoteKeys(guildId: number, cutoff: number): string[] {
    return (
      this.db
        .prepare(
          `
            SELECT vote_key
            FROM participation_states
            WHERE guild_id = ? AND spawn_time >= ? AND state IN ('INACTIVE', 'DELETED')
            ORDER BY spawn_time ASC, vote_key ASC
          `,
        )
        .all(guildId, cutoff) as Array<{ vote_key: string }>
    ).map((row) => row.vote_key);
  }

  public isVoteClosed(guildId: number, voteKey: string): boolean {
    const row = this.db
      .prepare(
        `
          SELECT state
          FROM participation_states
          WHERE guild_id = ? AND vote_key = ?
        `,
      )
      .get(guildId, voteKey) as { state: string } | undefined;
    return row?.state === 'INACTIVE' || row?.state === 'DELETED';
  }

  public toggleParticipation(
    actor: ScheduleActor,
    voteKey: string,
    boss: string,
    spawnTime: number,
  ): boolean {
    return withTransaction(this.db, () => {
      const existing = this.db
        .prepare(
          'SELECT 1 AS found FROM boss_participants WHERE guild_id = ? AND vote_key = ? AND user_id = ?',
        )
        .get(actor.guildId, voteKey, actor.id) as { found: number } | undefined;
      const joined = !existing;
      if (existing) {
        this.db
          .prepare(
            'DELETE FROM boss_participants WHERE guild_id = ? AND vote_key = ? AND user_id = ?',
          )
          .run(actor.guildId, voteKey, actor.id);
      } else {
        this.db
          .prepare(
            `
              INSERT INTO boss_participants (
                guild_id, vote_key, boss, spawn_time, user_id, nickname_snapshot
              )
              VALUES (?, ?, ?, ?, ?, ?)
            `,
          )
          .run(actor.guildId, voteKey, boss, spawnTime, actor.id, actor.nickname);
      }
      this.insertAudit(actor, null, 'PARTICIPATION_TOGGLED', { voteKey, joined });
      return joined;
    });
  }

  private replaceCurrent(
    actor: ScheduleActor,
    input: ResolvedScheduleInput,
    isMung: boolean,
  ): number {
    this.db
      .prepare('DELETE FROM boss_schedules WHERE guild_id = ? AND boss_definition_id = ?')
      .run(actor.guildId, input.bossDefinitionId);
    const result = this.db
      .prepare(
        `
          INSERT INTO boss_schedules (
            guild_id, boss_definition_id, spawn_time, is_mung, created_by
          )
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(actor.guildId, input.bossDefinitionId, input.spawnTime, isMung ? 1 : 0, actor.id);
    return Number(result.lastInsertRowid);
  }

  private insertAudit(
    actor: ScheduleActor,
    scheduleId: number | null,
    action:
      | 'SCHEDULES_SAVED'
      | 'SCHEDULE_CUT'
      | 'SCHEDULE_MUNG'
      | 'SCHEDULE_DELETED'
      | 'SCHEDULES_RESET'
      | 'TARGETS_CHANGED'
      | 'PARTICIPATION_TOGGLED',
    metadata: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        `
          INSERT INTO schedule_audit_logs (
            guild_id, actor_user_id, schedule_id, action, metadata_json
          )
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(actor.guildId, actor.id, scheduleId, action, JSON.stringify(metadata));
  }
}
