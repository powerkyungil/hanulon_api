import { AppError } from '../../shared/errors/app-error';
import { SchedulesService } from '../schedules/schedules.service';
import { BossVotesRepository } from './boss-votes.repository';
import type {
  ManualVoteInput,
  VoteActor,
  VoteBoss,
  VoteMemberRates,
  VoteStatistics,
  VoteStatisticsBoss,
} from './boss-votes.types';

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('UNIQUE constraint failed');

export class BossVotesService {
  public constructor(
    private readonly repository: BossVotesRepository,
    private readonly schedulesService: SchedulesService,
  ) {}

  public getVotes(userId: number, guildId: number): VoteBoss[] {
    this.requireActiveActor(userId, guildId);
    const window = this.listWindow();
    return this.getVotesForRange(userId, guildId, window.startMs, window.endMs, true);
  }

  public deleteManualVote(userId: number, guildId: number, id: number): void {
    const actor = this.requireManager(userId, guildId);
    const vote = this.repository.findManualVote(guildId, id);
    if (!vote) throw new AppError('BOSS_VOTE_NOT_FOUND', '보스 투표를 찾을 수 없습니다.', 404);
    this.repository.deleteManualVote(actor, vote);
  }

  public closeVote(
    userId: number,
    guildId: number,
    voteKey: string,
    boss: string,
    spawnTime: number,
  ): void {
    const actor = this.requireManager(userId, guildId);
    const normalizedBoss = boss.trim();
    const vote = this.getVotesForRange(userId, guildId, spawnTime, spawnTime, true).find(
      (candidate) => candidate.voteKey === voteKey,
    );
    if (!vote || vote.boss !== normalizedBoss || vote.spawnTime !== spawnTime) {
      throw new AppError('BOSS_VOTE_NOT_FOUND', '보스 투표를 찾을 수 없습니다.', 404);
    }
    this.repository.setVoteState(actor, voteKey, normalizedBoss, spawnTime, 'INACTIVE');
  }

  public removeParticipant(
    userId: number,
    guildId: number,
    voteKey: string,
    targetUserId: number,
  ): void {
    const actor = this.requireManager(userId, guildId);
    if (!this.repository.removeParticipant(actor, voteKey, targetUserId)) {
      throw new AppError('VOTE_PARTICIPANT_NOT_FOUND', '투표 참여자를 찾을 수 없습니다.', 404);
    }
  }

  public getStatistics(userId: number, guildId: number, month: string): VoteStatistics {
    this.requireManager(userId, guildId);
    const range = this.parseMonthRange(month);
    const votes = this.getVotesForRange(userId, guildId, range.startMs, range.endMs, false);
    const participants = this.repository.findParticipantsInRange(
      guildId,
      range.startMs,
      range.endMs,
    );
    const participantsByVote = new Map<string, typeof participants>();
    participants.forEach((participant) => {
      const list = participantsByVote.get(participant.voteKey) ?? [];
      list.push(participant);
      participantsByVote.set(participant.voteKey, list);
    });
    const days = new Map<string, VoteStatistics['days'][number]>();
    votes.forEach((vote) => {
      const dateKey = this.seoulDateKey(vote.spawnTime);
      const voteParticipants = participantsByVote.get(vote.voteKey) ?? [];
      const boss: VoteStatisticsBoss = {
        voteKey: vote.voteKey,
        dateKey,
        boss: vote.boss,
        spawnTime: vote.spawnTime,
        type: vote.type,
        region: vote.region,
        isManual: vote.isManual,
        isBlessed: vote.isBlessed,
        participants: voteParticipants.map((participant) => ({
          userId: participant.userId,
          nickname: participant.nickname,
          joinedAt: participant.joinedAt,
        })),
        participantCount: voteParticipants.length,
      };
      const day = days.get(dateKey) ?? { date: dateKey, bosses: [], totalParticipants: 0 };
      day.bosses.push(boss);
      day.totalParticipants += boss.participantCount;
      days.set(dateKey, day);
    });
    const dayList = [...days.values()];
    return {
      month,
      totalBosses: votes.length,
      totalParticipants: dayList.reduce((sum, day) => sum + day.totalParticipants, 0),
      days: dayList,
    };
  }

  public getMemberRates(
    userId: number,
    guildId: number,
    start: string,
    end: string,
  ): VoteMemberRates {
    this.requireManager(userId, guildId);
    const range = this.parseDateRange(start, end);
    const votes = this.getVotesForRange(userId, guildId, range.startMs, range.endMs, false);
    const voteKeys = new Set(votes.map((vote) => vote.voteKey));
    const participationByUser = new Map<number, Set<string>>();
    this.repository
      .findParticipantsInRange(guildId, range.startMs, range.endMs)
      .filter((participant) => voteKeys.has(participant.voteKey))
      .forEach((participant) => {
        const joined = participationByUser.get(participant.userId) ?? new Set<string>();
        joined.add(participant.voteKey);
        participationByUser.set(participant.userId, joined);
      });
    const totalBosses = votes.length;
    const members = this.repository.findActiveMembers(guildId).map((member) => {
      const joinedCount = participationByUser.get(member.userId)?.size ?? 0;
      return {
        ...member,
        joinedCount,
        totalBosses,
        missedCount: Math.max(totalBosses - joinedCount, 0),
        rate: totalBosses > 0 ? Math.round((joinedCount / totalBosses) * 1_000) / 10 : 0,
      };
    });
    return { start, end, totalBosses, memberCount: members.length, members };
  }

  private getVotesForRange(
    userId: number,
    guildId: number,
    startMs: number,
    endMs: number,
    includeClosed: boolean,
  ): VoteBoss[] {
    const actor = this.requireActiveActor(userId, guildId);
    const scheduled = this.schedulesService.getVoteOccurrences(userId, guildId, startMs, endMs);
    const manual = this.repository.findManualVotes(guildId, startMs, endMs);
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
        isFixed: occurrence.isFixed,
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
        isFixed: false,
      })),
    ];
    const states = this.repository.findStatesInRange(guildId, startMs, endMs);
    const visible = baseVotes.filter(
      (vote) =>
        states[vote.voteKey] !== 'DELETED' &&
        (includeClosed || states[vote.voteKey] !== 'INACTIVE'),
    );
    const participantRows = this.repository.findParticipantsInRange(guildId, startMs, endMs);
    const visibleKeys = new Set(visible.map((vote) => vote.voteKey));
    const participants: Record<string, Array<{ userId: number; nickname: string }>> = {};
    participantRows.forEach((participant) => {
      if (!visibleKeys.has(participant.voteKey)) return;
      (participants[participant.voteKey] ??= []).push({
        userId: participant.userId,
        nickname: participant.nickname,
      });
    });
    return visible
      .map((vote) => {
        const voteParticipants = participants[vote.voteKey] ?? [];
        return {
          ...vote,
          participants: voteParticipants,
          participantCount: voteParticipants.length,
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

  private parseMonthRange(month: string): { startMs: number; endMs: number } {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    const year = Number(match?.[1]);
    const monthNumber = Number(match?.[2]);
    if (!match || monthNumber < 1 || monthNumber > 12) {
      throw new AppError('VOTE_STATS_MONTH_INVALID', 'month는 YYYY-MM 형식이어야 합니다.', 400);
    }
    return {
      startMs: Date.UTC(year, monthNumber - 1, 1) - 9 * 3_600_000,
      endMs: Date.UTC(year, monthNumber, 1) - 9 * 3_600_000 - 1,
    };
  }

  private parseDateRange(start: string, end: string): { startMs: number; endMs: number } {
    const startMs = this.parseSeoulDate(start);
    const endMs = this.parseSeoulDate(end) + 24 * 3_600_000 - 1;
    if (startMs > endMs) {
      throw new AppError('VOTE_STATS_RANGE_INVALID', '조회 기간을 확인해 주세요.', 400);
    }
    return { startMs, endMs };
  }

  private parseSeoulDate(value: string): number {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      throw new AppError('VOTE_STATS_DATE_INVALID', '날짜는 YYYY-MM-DD 형식이어야 합니다.', 400);
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utcDate = new Date(Date.UTC(year, month - 1, day));
    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      utcDate.getUTCFullYear() !== year ||
      utcDate.getUTCMonth() !== month - 1 ||
      utcDate.getUTCDate() !== day
    ) {
      throw new AppError('VOTE_STATS_DATE_INVALID', '날짜는 YYYY-MM-DD 형식이어야 합니다.', 400);
    }
    return utcDate.getTime() - 9 * 3_600_000;
  }

  private seoulDateKey(epochMs: number): string {
    return new Date(epochMs + 9 * 3_600_000).toISOString().slice(0, 10);
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
