import type Database from 'better-sqlite3';

import { withTransaction } from '../../infrastructure/db/transaction';
import type { UserRole } from '../auth/auth.types';
import type { ManualVote, ManualVoteInput, VoteActor, VoteParticipant } from './boss-votes.types';

interface ActorRow {
  id: number;
  guild_id: number;
  role: UserRole;
  nickname: string;
  is_active: number;
}

interface ManualVoteRow {
  id: number;
  type: string;
  region: string;
  boss: string;
  spawn_time: number;
  is_blessed: number;
}

export class BossVotesRepository {
  public constructor(private readonly db: Database.Database) {}

  public findActor(userId: number, guildId: number): VoteActor | null {
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

  public findManualVotes(guildId: number, startMs: number, endMs: number): ManualVote[] {
    const rows = this.db
      .prepare(
        `
          SELECT id, type, region, boss, spawn_time, is_blessed
          FROM manual_boss_votes
          WHERE guild_id = ? AND spawn_time BETWEEN ? AND ?
          ORDER BY spawn_time ASC, id ASC
        `,
      )
      .all(guildId, startMs, endMs) as ManualVoteRow[];
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      region: row.region,
      boss: row.boss,
      spawnTime: row.spawn_time,
      isBlessed: row.is_blessed === 1,
    }));
  }

  public createManualVote(actor: VoteActor, input: ManualVoteInput): number {
    return withTransaction(this.db, () => {
      const result = this.db
        .prepare(
          `
            INSERT INTO manual_boss_votes (
              guild_id, type, region, boss, spawn_time, is_blessed, created_by
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          actor.guildId,
          input.type,
          input.region,
          input.boss,
          input.spawnTime,
          input.isBlessed ? 1 : 0,
          actor.id,
        );
      const id = Number(result.lastInsertRowid);
      this.insertAudit(actor, `manual|${id}`, 'MANUAL_VOTE_CREATED', { ...input });
      return id;
    });
  }

  public findStates(
    guildId: number,
    voteKeys: string[],
  ): Record<string, 'ACTIVE' | 'INACTIVE' | 'DELETED'> {
    if (voteKeys.length === 0) return {};
    const placeholders = voteKeys.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `
          SELECT vote_key, state
          FROM participation_states
          WHERE guild_id = ? AND vote_key IN (${placeholders})
        `,
      )
      .all(guildId, ...voteKeys) as Array<{
      vote_key: string;
      state: 'ACTIVE' | 'INACTIVE' | 'DELETED';
    }>;
    return Object.fromEntries(rows.map((row) => [row.vote_key, row.state]));
  }

  public findParticipants(guildId: number, voteKeys: string[]): Record<string, VoteParticipant[]> {
    if (voteKeys.length === 0) return {};
    const placeholders = voteKeys.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `
          SELECT vote_key, user_id, nickname_snapshot
          FROM boss_participants
          WHERE guild_id = ? AND vote_key IN (${placeholders})
          ORDER BY created_at ASC, user_id ASC
        `,
      )
      .all(guildId, ...voteKeys) as Array<{
      vote_key: string;
      user_id: number;
      nickname_snapshot: string;
    }>;
    const result: Record<string, VoteParticipant[]> = {};
    rows.forEach((row) => {
      (result[row.vote_key] ??= []).push({
        userId: row.user_id,
        nickname: row.nickname_snapshot,
      });
    });
    return result;
  }

  public toggleParticipation(
    actor: VoteActor,
    voteKey: string,
    boss: string,
    spawnTime: number,
  ): boolean {
    return withTransaction(this.db, () => {
      const state = this.db
        .prepare('SELECT state FROM participation_states WHERE guild_id = ? AND vote_key = ?')
        .get(actor.guildId, voteKey) as { state: string } | undefined;
      if (state?.state === 'INACTIVE' || state?.state === 'DELETED') {
        throw new Error('BOSS_VOTE_CLOSED');
      }
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
      this.insertAudit(actor, voteKey, 'PARTICIPATION_TOGGLED', { joined });
      return joined;
    });
  }

  private insertAudit(
    actor: VoteActor,
    voteKey: string,
    action: 'MANUAL_VOTE_CREATED' | 'PARTICIPATION_TOGGLED',
    metadata: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        `
          INSERT INTO boss_vote_audit_logs (
            guild_id, actor_user_id, vote_key, action, metadata_json
          )
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(actor.guildId, actor.id, voteKey, action, JSON.stringify(metadata));
  }
}
