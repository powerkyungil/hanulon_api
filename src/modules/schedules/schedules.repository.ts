import type Database from 'better-sqlite3';

import { withTransaction } from '../../infrastructure/db/transaction';
import { requireCharacterIdentity } from '../../shared/character-identity';
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

  public findHistory(guildId: number, startMs: number, endMs: number): VoteOccurrence[] {
    const rows = this.db
      .prepare(
        `
          SELECT history.type, history.region, history.boss, history.spawn_time
          FROM schedule_history AS history
          WHERE history.guild_id = ?
            AND history.spawn_time BETWEEN ? AND ?
            AND (
              EXISTS (
                SELECT 1
                FROM participation_targets AS target
                WHERE target.guild_id = history.guild_id
                  AND target.type = history.type
                  AND target.region = history.region
                  AND target.boss = history.boss
              )
              OR EXISTS (
                SELECT 1
                FROM boss_participants AS participant
                WHERE participant.guild_id = history.guild_id
                  AND participant.vote_key = history.type || '|' || history.region || '|'
                    || history.boss || '|' || history.spawn_time
              )
              OR EXISTS (
                SELECT 1
                FROM participation_states AS state
                WHERE state.guild_id = history.guild_id
                  AND state.vote_key = history.type || '|' || history.region || '|'
                    || history.boss || '|' || history.spawn_time
              )
            )
          ORDER BY history.spawn_time ASC, history.id ASC
        `,
      )
      .all(guildId, startMs, endMs) as Array<{
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
      inputs.forEach((input) => {
        this.replaceCurrent(actor, input, false);
      });
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
          `
            SELECT definition.id AS boss_definition_id
            FROM participation_targets AS target
            JOIN boss_definitions AS definition
              ON definition.guild_id = target.guild_id
              AND definition.type = target.type
              AND definition.region = target.region
              AND definition.boss = target.boss
            WHERE target.guild_id = ?
            ORDER BY definition.id ASC
          `,
        )
        .all(guildId) as Array<{ boss_definition_id: number }>
    ).map((row) => row.boss_definition_id);
  }

  public findTargetKeys(guildId: number): Array<{ type: string; region: string; boss: string }> {
    return this.db
      .prepare(
        `
          SELECT type, region, boss
          FROM participation_targets
          WHERE guild_id = ?
          ORDER BY type ASC, region ASC, boss ASC
        `,
      )
      .all(guildId) as Array<{ type: string; region: string; boss: string }>;
  }

  public replaceTargetDefinitionIds(actor: ScheduleActor, bossDefinitionIds: number[]): void {
    withTransaction(this.db, () => {
      const previous = this.findTargetDefinitionIds(actor.guildId);
      this.db.prepare('DELETE FROM participation_targets WHERE guild_id = ?').run(actor.guildId);
      const insert = this.db.prepare(
        `
          INSERT INTO participation_targets (guild_id, type, region, boss)
          SELECT guild_id, type, region, boss
          FROM boss_definitions
          WHERE guild_id = ? AND id = ?
        `,
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
    characterKey: string,
  ): boolean {
    return withTransaction(this.db, () => {
      const character = requireCharacterIdentity(this.db, actor.guildId, characterKey);
      const existing = this.db
        .prepare(
          `
            SELECT 1 AS found
            FROM boss_participants
            WHERE guild_id = ? AND vote_key = ? AND user_id = ? AND character_type = ?
          `,
        )
        .get(actor.guildId, voteKey, character.ownerUserId, character.characterType) as
        { found: number } | undefined;
      const joined = !existing;
      if (existing) {
        this.db
          .prepare(
            `
              DELETE FROM boss_participants
              WHERE guild_id = ? AND vote_key = ? AND user_id = ? AND character_type = ?
            `,
          )
          .run(actor.guildId, voteKey, character.ownerUserId, character.characterType);
      } else {
        this.db
          .prepare(
            `
              INSERT INTO boss_participants (
                guild_id, vote_key, boss, spawn_time, user_id, character_type,
                character_name_snapshot, nickname_snapshot, actor_type, actor_id,
                actor_nickname_snapshot
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            actor.guildId,
            voteKey,
            boss,
            spawnTime,
            character.ownerUserId,
            character.characterType,
            character.characterName,
            character.characterName,
            actor.deputyId ? 'DEPUTY' : 'USER',
            actor.actorUserId ?? actor.deputyId ?? actor.id,
            actor.actorNickname ?? actor.nickname,
          );
      }
      this.insertAudit(actor, null, 'PARTICIPATION_TOGGLED', {
        voteKey,
        joined,
        characterKey,
        characterName: character.characterName,
      });
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
    this.db
      .prepare(
        `
          UPDATE schedule_history SET vote_hidden = 0
          WHERE guild_id = ? AND type = ? AND region = ? AND boss = ? AND spawn_time = ?
        `,
      )
      .run(actor.guildId, input.type, input.region, input.boss, input.spawnTime);
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
            guild_id, actor_user_id, actor_deputy_id, schedule_id, action, metadata_json
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        actor.guildId,
        actor.actorUserId ?? actor.id,
        actor.deputyId ?? null,
        scheduleId,
        action,
        JSON.stringify(metadata),
      );
  }
}
