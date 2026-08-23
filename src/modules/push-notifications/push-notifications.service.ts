import { AppError } from '../../shared/errors/app-error';
import { PushNotificationsRepository } from './push-notifications.repository';
import type {
  BossNotificationLeadSeconds,
  BossPushCandidate,
  BossPushRunResult,
  PushMessage,
  PushSender,
  PushTokenActor,
  RegisteredPushToken,
  RegisterPushTokenInput,
} from './push-notifications.types';

const LEAD_SECONDS: BossNotificationLeadSeconds[] = [300, 60, 0];
const CLAIM_LEASE_MS = 45 * 1000;
const RETRY_DELAY_MS = 60 * 1000;

export class PushTokenService {
  public constructor(private readonly repository: PushNotificationsRepository) {}

  public register(
    userId: number,
    guildId: number,
    input: RegisterPushTokenInput,
  ): RegisteredPushToken {
    const actor = this.requireActiveActor(userId, guildId);
    return this.repository.upsertToken(actor, {
      ...input,
      token: input.token.trim(),
      deviceId: input.deviceId?.trim(),
    });
  }

  public delete(userId: number, guildId: number, token: string): void {
    this.requireActiveActor(userId, guildId);
    this.repository.deleteToken(userId, token.trim());
  }

  private requireActiveActor(userId: number, guildId: number): PushTokenActor {
    const actor = this.repository.findActor(userId, guildId);
    if (!actor || !actor.isActive) {
      throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    }
    return actor;
  }
}

export class BossPushDispatchService {
  public constructor(
    private readonly repository: PushNotificationsRepository,
    private readonly sender: PushSender,
    private readonly dispatchWindowMs: number,
  ) {}

  public async run(nowMs = Date.now()): Promise<BossPushRunResult> {
    const result: BossPushRunResult = {
      candidates: 0,
      sent: 0,
      failed: 0,
      invalidTokensRemoved: 0,
      skipped: 0,
    };

    for (const leadSeconds of LEAD_SECONDS) {
      const candidates = this.repository.findDueCandidates(
        nowMs,
        this.dispatchWindowMs,
        leadSeconds,
      );
      result.candidates += candidates.length;
      for (const candidate of candidates) {
        if (!this.repository.claimDelivery(candidate, nowMs, CLAIM_LEASE_MS)) {
          result.skipped += 1;
          continue;
        }
        try {
          const sendResult = await this.sender.send(this.toMessage(candidate));
          if (sendResult.invalidToken) {
            this.repository.markFailed(
              candidate,
              nowMs,
              sendResult.errorCode ?? 'FCM_TOKEN_INVALID',
              null,
            );
            if (this.repository.deleteInvalidToken(candidate.deviceTokenId)) {
              result.invalidTokensRemoved += 1;
            }
          } else if (sendResult.errorCode) {
            this.repository.markFailed(candidate, nowMs, sendResult.errorCode, RETRY_DELAY_MS);
            result.failed += 1;
          } else {
            this.repository.markSent(candidate, nowMs);
            result.sent += 1;
          }
        } catch (error) {
          const errorCode =
            error instanceof Error ? error.name || 'FCM_SEND_FAILED' : 'FCM_SEND_FAILED';
          this.repository.markFailed(candidate, nowMs, errorCode, RETRY_DELAY_MS);
          result.failed += 1;
        }
      }
    }
    return result;
  }

  private toMessage(candidate: BossPushCandidate): PushMessage {
    const prefix = candidate.region ? `[${candidate.region}] ` : '';
    const timing =
      candidate.leadSeconds === 0
        ? '출현 시간입니다.'
        : `${candidate.leadSeconds / 60}분 후 출현합니다.`;
    const title =
      candidate.leadSeconds === 0
        ? `${candidate.boss} 출현`
        : `${candidate.boss} 출현 ${candidate.leadSeconds / 60}분 전`;
    return {
      token: candidate.token,
      title,
      body: `${prefix}${candidate.boss} ${timing}`,
      data: {
        type: 'BOSS_SCHEDULE',
        notificationKey: [
          'boss',
          candidate.guildId,
          candidate.bossDefinitionId,
          candidate.spawnTime,
          candidate.leadSeconds,
        ].join(':'),
        guildId: String(candidate.guildId),
        scheduleId: candidate.scheduleId === null ? '' : String(candidate.scheduleId),
        bossDefinitionId: String(candidate.bossDefinitionId),
        bossType: candidate.type,
        region: candidate.region,
        boss: candidate.boss,
        spawnTime: String(candidate.spawnTime),
        leadSeconds: String(candidate.leadSeconds),
      },
    };
  }
}
