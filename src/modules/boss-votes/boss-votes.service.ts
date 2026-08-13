import { AppError } from '../../shared/errors/app-error';
import { SchedulesService } from '../schedules/schedules.service';
import { BossVotesRepository } from './boss-votes.repository';
import type { ManualVoteInput, VoteActor, VoteBoss } from './boss-votes.types';

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('UNIQUE constraint failed');

export class BossVotesService {
  public constructor(
    private readonly repository: BossVotesRepository,
    private readonly schedulesService: SchedulesService,
  ) {}

  public getVotes(userId: number, guildId: number): VoteBoss[] {
    const actor = this.requireActiveActor(userId, guildId);
    const window = this.listWindow();
    const scheduled = this.schedulesService.getVoteOccurrences(
      userId,
      guildId,
      window.startMs,
      window.endMs,
    );
    const manual = this.repository.findManualVotes(guildId, window.startMs, window.endMs);
    const baseVotes = [
      ...scheduled.map((occurrence) => ({
        id: occurrence.id,
        voteKey: this.scheduleVoteKey(occurrence),
        type: occurrence.type,
        region: occurrence.region,
        boss: occurrence.boss,
        spawnTime: occurrence.spawnTime,
        isBlessed: false,
        isManual: false,
        isHistory: occurrence.isHistory,
      })),
      ...manual.map((vote) => ({
        id: vote.id,
        voteKey: `manual|${vote.id}`,
        type: vote.type,
        region: vote.region,
        boss: vote.boss,
        spawnTime: vote.spawnTime,
        isBlessed: vote.isBlessed,
        isManual: true,
        isHistory: false,
      })),
    ];
    const states = this.repository.findStates(
      guildId,
      baseVotes.map((vote) => vote.voteKey),
    );
    const visible = baseVotes.filter((vote) => states[vote.voteKey] !== 'DELETED');
    const participants = this.repository.findParticipants(
      guildId,
      visible.map((vote) => vote.voteKey),
    );
    return visible
      .map((vote) => {
        const voteParticipants = participants[vote.voteKey] ?? [];
        return {
          ...vote,
          participants: voteParticipants,
          joined: voteParticipants.some((participant) => participant.userId === actor.id),
          isClosed: states[vote.voteKey] === 'INACTIVE',
        };
      })
      .sort((a, b) => a.spawnTime - b.spawnTime || a.voteKey.localeCompare(b.voteKey));
  }

  public createManualVote(userId: number, guildId: number, input: ManualVoteInput): number {
    const actor = this.requireManager(userId, guildId);
    const normalized = this.normalizeInput(input);
    const window = this.manualCreationWindow();
    if (normalized.spawnTime < window.startMs || normalized.spawnTime > window.endMs) {
      throw new AppError(
        'MANUAL_VOTE_TIME_OUT_OF_RANGE',
        '수동 투표는 오늘 또는 내일 일정만 등록할 수 있습니다.',
        422,
      );
    }
    try {
      return this.repository.createManualVote(actor, normalized);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppError('BOSS_VOTE_EXISTS', '이미 등록된 수동 투표입니다.', 409);
      }
      throw error;
    }
  }

  public toggleParticipation(
    userId: number,
    guildId: number,
    voteKey: string,
    boss: string,
    spawnTime: number,
  ): boolean {
    const actor = this.requireActiveActor(userId, guildId);
    const vote = this.getVotes(userId, guildId).find((item) => item.voteKey === voteKey);
    if (!vote || vote.boss !== boss.trim() || vote.spawnTime !== spawnTime) {
      throw new AppError('BOSS_VOTE_NOT_FOUND', '보스 투표를 찾을 수 없습니다.', 404);
    }
    if (vote.isClosed) {
      throw new AppError('BOSS_VOTE_CLOSED', '마감된 투표에는 참여할 수 없습니다.', 409);
    }
    try {
      return this.repository.toggleParticipation(actor, voteKey, vote.boss, vote.spawnTime);
    } catch (error) {
      if (error instanceof Error && error.message === 'BOSS_VOTE_CLOSED') {
        throw new AppError('BOSS_VOTE_CLOSED', '마감된 투표에는 참여할 수 없습니다.', 409);
      }
      throw error;
    }
  }

  private normalizeInput(input: ManualVoteInput): ManualVoteInput {
    const type = input.type.trim() || '본섭';
    const region = input.region.trim();
    const boss = input.boss.trim();
    if (
      !type ||
      !boss ||
      [type, region, boss].some((value) => value.includes('|')) ||
      !Number.isSafeInteger(input.spawnTime) ||
      input.spawnTime < 0
    ) {
      throw new AppError('MANUAL_VOTE_INVALID', '수동 투표 정보를 확인해 주세요.', 422);
    }
    return { ...input, type, region, boss };
  }

  private requireActiveActor(userId: number, guildId: number): VoteActor {
    const actor = this.repository.findActor(userId, guildId);
    if (!actor || !actor.isActive) throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    return actor;
  }

  private requireManager(userId: number, guildId: number): VoteActor {
    const actor = this.requireActiveActor(userId, guildId);
    if (actor.role !== 'MASTER' && actor.role !== 'ADMIN') {
      throw new AppError('FORBIDDEN', '보스 투표 관리 권한이 없습니다.', 403);
    }
    return actor;
  }

  private listWindow(): { startMs: number; endMs: number } {
    return {
      startMs: this.seoulDayStart(-1),
      endMs: this.seoulDayStart(2) - 1,
    };
  }

  private manualCreationWindow(): { startMs: number; endMs: number } {
    return {
      startMs: this.seoulDayStart(0),
      endMs: this.seoulDayStart(2) - 1,
    };
  }

  private seoulDayStart(dayOffset: number): number {
    const seoul = new Date(Date.now() + 9 * 3_600_000);
    return (
      Date.UTC(seoul.getUTCFullYear(), seoul.getUTCMonth(), seoul.getUTCDate() + dayOffset) -
      9 * 3_600_000
    );
  }

  private scheduleVoteKey(vote: {
    type: string;
    region: string;
    boss: string;
    spawnTime: number;
  }): string {
    return `${vote.type}|${vote.region}|${vote.boss}|${vote.spawnTime}`;
  }
}
