import type Database from 'better-sqlite3';

import { withTransaction } from '../../infrastructure/db/transaction';
import type {
  BossNotificationLeadSeconds,
  BossPushCandidate,
  PushTokenActor,
  RegisteredPushToken,
  RegisterPushTokenInput,
} from './push-notifications.types';

interface ActorRow {
  id: number;
  guild_id: number;
  is_active: number;
}

interface TokenRow {
  id: number;
  platform: 'ANDROID';
  device_id: string | null;
  updated_at_ms: number;
}

interface CandidateRow {
  guild_id: number;
  schedule_id: number | null;
  boss_definition_id: number;
  type: string;
  region: string;
  boss: string;
  spawn_time: number;
  user_id: number;
  device_token_id: number;
  device_key: string;
  token: string;
}

interface FixedCandidateRow extends CandidateRow {
  time_text: string;
  days: string;
}

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

export class PushNotificationsRepository {
  public constructor(private readonly db: Database.Database) {}

  public findActor(userId: number, guildId: number): PushTokenActor | null {
    const row = this.db
      .prepare('SELECT id, guild_id, is_active FROM users WHERE id = ? AND guild_id = ? LIMIT 1')
      .get(userId, guildId) as ActorRow | undefined;
    return row ? { id: row.id, guildId: row.guild_id, isActive: row.is_active === 1 } : null;
  }

  public upsertToken(actor: PushTokenActor, input: RegisterPushTokenInput): RegisteredPushToken {
    return withTransaction(this.db, () => {
      if (input.deviceId) {
        const existingDevice = this.db
          .prepare('SELECT id FROM push_device_tokens WHERE user_id = ? AND device_id = ? LIMIT 1')
          .get(actor.id, input.deviceId) as { id: number } | undefined;
        if (existingDevice) {
          this.db
            .prepare('DELETE FROM push_device_tokens WHERE token = ? AND id <> ?')
            .run(input.token, existingDevice.id);
          this.db
            .prepare(
              `
                UPDATE push_device_tokens
                SET token = ?, guild_id = ?, platform = ?,
                    updated_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP
                WHERE id = ?
              `,
            )
            .run(input.token, actor.guildId, input.platform, existingDevice.id);
          return this.findToken(input.token);
        }
      }
      this.db
        .prepare(
          `
            INSERT INTO push_device_tokens (user_id, guild_id, token, platform, device_id)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(token) DO UPDATE SET
              user_id = excluded.user_id,
              guild_id = excluded.guild_id,
              platform = excluded.platform,
              device_id = excluded.device_id,
              updated_at = CURRENT_TIMESTAMP,
              last_seen_at = CURRENT_TIMESTAMP
          `,
        )
        .run(actor.id, actor.guildId, input.token, input.platform, input.deviceId ?? null);
      return this.findToken(input.token);
    });
  }

  public deleteToken(userId: number, token: string): boolean {
    return (
      this.db
        .prepare('DELETE FROM push_device_tokens WHERE user_id = ? AND token = ?')
        .run(userId, token).changes > 0
    );
  }

  public findDueCandidates(
    nowMs: number,
    dispatchWindowMs: number,
    leadSeconds: BossNotificationLeadSeconds,
  ): BossPushCandidate[] {
    const targetStart = nowMs - dispatchWindowMs;
    const spawnStart = targetStart + leadSeconds * 1000;
    const spawnEnd = nowMs + leadSeconds * 1000;
    const rows = this.db
      .prepare(
        `
          SELECT
            bs.guild_id,
            bs.id AS schedule_id,
            bs.boss_definition_id,
            bd.type,
            bd.region,
            bd.boss,
            bs.spawn_time,
            u.id AS user_id,
            pdt.id AS device_token_id,
            COALESCE(pdt.device_id, 'token:' || pdt.id) AS device_key,
            pdt.token
          FROM boss_schedules AS bs
          JOIN boss_definitions AS bd
            ON bd.id = bs.boss_definition_id AND bd.guild_id = bs.guild_id
          JOIN users AS u
            ON u.guild_id = bs.guild_id AND u.is_active = 1
          JOIN push_device_tokens AS pdt
            ON pdt.user_id = u.id AND pdt.guild_id = u.guild_id
          WHERE bs.spawn_time BETWEEN ? AND ?
            AND bd.type <> '고정'
          ORDER BY bs.spawn_time ASC, bs.guild_id ASC, u.id ASC, pdt.id ASC
        `,
      )
      .all(spawnStart, spawnEnd) as CandidateRow[];
    const storedCandidates = rows.map((row) => this.mapCandidate(row, leadSeconds));
    return [...storedCandidates, ...this.findDueFixedCandidates(spawnStart, spawnEnd, leadSeconds)];
  }

  private findDueFixedCandidates(
    spawnStart: number,
    spawnEnd: number,
    leadSeconds: BossNotificationLeadSeconds,
  ): BossPushCandidate[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            bd.guild_id,
            NULL AS schedule_id,
            bd.id AS boss_definition_id,
            bd.type,
            bd.region,
            bd.boss,
            0 AS spawn_time,
            bd.time_text,
            bd.days,
            u.id AS user_id,
            pdt.id AS device_token_id,
            COALESCE(pdt.device_id, 'token:' || pdt.id) AS device_key,
            pdt.token
          FROM boss_definitions AS bd
          JOIN users AS u ON u.guild_id = bd.guild_id AND u.is_active = 1
          JOIN push_device_tokens AS pdt
            ON pdt.user_id = u.id AND pdt.guild_id = u.guild_id
          WHERE bd.type = '고정' AND bd.time_text IS NOT NULL AND bd.days IS NOT NULL
          ORDER BY bd.guild_id ASC, bd.id ASC, u.id ASC, pdt.id ASC
        `,
      )
      .all() as FixedCandidateRow[];
    const firstSeoul = new Date(spawnStart + SEOUL_OFFSET_MS);
    const lastSeoul = new Date(spawnEnd + SEOUL_OFFSET_MS);
    const firstDay = Date.UTC(
      firstSeoul.getUTCFullYear(),
      firstSeoul.getUTCMonth(),
      firstSeoul.getUTCDate(),
    );
    const lastDay = Date.UTC(
      lastSeoul.getUTCFullYear(),
      lastSeoul.getUTCMonth(),
      lastSeoul.getUTCDate(),
    );
    const candidates: BossPushCandidate[] = [];
    for (let day = firstDay; day <= lastDay; day += 24 * 60 * 60 * 1000) {
      const date = new Date(day);
      const dayLabel = DAY_LABELS[date.getUTCDay()] ?? '';
      for (const row of rows) {
        if (!row.days.split(',').includes(dayLabel)) continue;
        const [hour, minute, second = 0] = row.time_text.split(':').map(Number);
        if (
          !Number.isInteger(hour) ||
          !Number.isInteger(minute) ||
          !Number.isInteger(second) ||
          hour < 0 ||
          hour > 23 ||
          minute < 0 ||
          minute > 59 ||
          second < 0 ||
          second > 59
        ) {
          continue;
        }
        const spawnTime = Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          hour - 9,
          minute,
          second,
        );
        if (spawnTime < spawnStart || spawnTime > spawnEnd) continue;
        candidates.push(this.mapCandidate({ ...row, spawn_time: spawnTime }, leadSeconds));
      }
    }
    return candidates;
  }

  private mapCandidate(
    row: CandidateRow,
    leadSeconds: BossNotificationLeadSeconds,
  ): BossPushCandidate {
    return {
      guildId: row.guild_id,
      scheduleId: row.schedule_id,
      bossDefinitionId: row.boss_definition_id,
      type: row.type,
      region: row.region,
      boss: row.boss,
      spawnTime: row.spawn_time,
      leadSeconds,
      userId: row.user_id,
      deviceTokenId: row.device_token_id,
      deviceKey: row.device_key,
      token: row.token,
    };
  }

  public claimDelivery(candidate: BossPushCandidate, nowMs: number, leaseMs: number): boolean {
    return withTransaction(this.db, () => {
      const inserted = this.db
        .prepare(
          `
            INSERT OR IGNORE INTO push_delivery_history (
              guild_id, boss_definition_id, schedule_id, spawn_time, lead_seconds,
              user_id, device_token_id, device_key, status, claim_expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSING', ?)
          `,
        )
        .run(
          candidate.guildId,
          candidate.bossDefinitionId,
          candidate.scheduleId,
          candidate.spawnTime,
          candidate.leadSeconds,
          candidate.userId,
          candidate.deviceTokenId,
          candidate.deviceKey,
          nowMs + leaseMs,
        );
      const result = this.db
        .prepare(
          `
            UPDATE push_delivery_history
            SET status = 'PROCESSING',
                attempt_count = attempt_count + 1,
                claim_expires_at = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE guild_id = ?
              AND boss_definition_id = ?
              AND spawn_time = ?
              AND lead_seconds = ?
              AND device_key = ?
              AND (
                (status = 'FAILED' AND COALESCE(next_retry_at, 0) <= ?)
                OR (status = 'PROCESSING' AND claim_expires_at < ?)
              )
          `,
        )
        .run(
          nowMs + leaseMs,
          candidate.guildId,
          candidate.bossDefinitionId,
          candidate.spawnTime,
          candidate.leadSeconds,
          candidate.deviceKey,
          nowMs,
          nowMs,
        );
      return inserted.changes > 0 || result.changes > 0;
    });
  }

  public markSent(candidate: BossPushCandidate, nowMs: number): void {
    this.updateDelivery(candidate, 'SENT', nowMs, null, null);
  }

  public markFailed(
    candidate: BossPushCandidate,
    nowMs: number,
    errorCode: string,
    retryDelayMs: number | null,
  ): void {
    this.updateDelivery(
      candidate,
      'FAILED',
      null,
      retryDelayMs === null ? null : nowMs + retryDelayMs,
      errorCode,
    );
  }

  public deleteInvalidToken(tokenId: number): boolean {
    return this.db.prepare('DELETE FROM push_device_tokens WHERE id = ?').run(tokenId).changes > 0;
  }

  private findToken(token: string): RegisteredPushToken {
    const row = this.db
      .prepare(
        `
          SELECT id, platform, device_id,
                 CAST(strftime('%s', updated_at) AS INTEGER) * 1000 AS updated_at_ms
          FROM push_device_tokens
          WHERE token = ?
        `,
      )
      .get(token) as TokenRow;
    return {
      id: row.id,
      platform: row.platform,
      deviceId: row.device_id,
      updatedAt: row.updated_at_ms,
    };
  }

  private updateDelivery(
    candidate: BossPushCandidate,
    status: 'SENT' | 'FAILED',
    sentAt: number | null,
    nextRetryAt: number | null,
    errorCode: string | null,
  ): void {
    this.db
      .prepare(
        `
          UPDATE push_delivery_history
          SET status = ?, sent_at = ?, next_retry_at = ?, last_error_code = ?,
              claim_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE guild_id = ? AND boss_definition_id = ? AND spawn_time = ?
            AND lead_seconds = ? AND device_key = ?
        `,
      )
      .run(
        status,
        sentAt,
        nextRetryAt,
        errorCode,
        candidate.guildId,
        candidate.bossDefinitionId,
        candidate.spawnTime,
        candidate.leadSeconds,
        candidate.deviceKey,
      );
  }
}
