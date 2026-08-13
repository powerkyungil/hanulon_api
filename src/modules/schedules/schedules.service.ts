import { AppError } from '../../shared/errors/app-error';
import type { BossDefinition } from '../bosses/bosses.types';
import { BossesService } from '../bosses/bosses.service';
import { SchedulesRepository } from './schedules.repository';
import type {
  BossSchedule,
  ParticipationToggleInput,
  ResolvedScheduleInput,
  ScheduleActor,
  ScheduleInput,
  VoteOccurrence,
} from './schedules.types';

const MAX_EPOCH_MS = 8_640_000_000_000_000;
const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

export class SchedulesService {
  public constructor(
    private readonly repository: SchedulesRepository,
    private readonly bossesService: BossesService,
    private readonly retentionDays: number,
  ) {}

  public getSchedules(userId: number, guildId: number): BossSchedule[] {
    this.requireActiveActor(userId, guildId);
    this.bossesService.ensureDefinitions(guildId);
    return this.repository.findAll(guildId);
  }

  public saveSchedules(userId: number, guildId: number, inputs: ScheduleInput[]): void {
    const actor = this.requireManager(userId, guildId);
    if (inputs.length === 0) {
      throw new AppError('SCHEDULE_LIST_EMPTY', '등록할 일정을 하나 이상 전달해 주세요.', 422);
    }
    const keys = inputs.map((input) => `${input.type}|${input.region}|${input.boss}`);
    if (new Set(keys).size !== keys.length) {
      throw new AppError('SCHEDULE_DUPLICATED', '같은 보스 일정이 중복되어 있습니다.', 409);
    }
    const resolved = inputs.map((input) => this.resolveInput(guildId, input));
    this.repository.saveMany(actor, resolved);
  }

  public cut(userId: number, guildId: number, key: Omit<ScheduleInput, 'spawnTime'>): number {
    const actor = this.requireManager(userId, guildId);
    const definition = this.requireCooldownDefinition(guildId, key);
    const spawnTime = Date.now() + Math.round(definition.cooldownHours * 3_600_000);
    this.repository.replaceForAction(
      actor,
      { ...key, bossDefinitionId: definition.id, spawnTime },
      false,
      'SCHEDULE_CUT',
    );
    return spawnTime;
  }

  public mung(userId: number, guildId: number, input: ScheduleInput): number {
    const actor = this.requireManager(userId, guildId);
    this.validateInput(input);
    const definition = this.requireCooldownDefinition(guildId, input);
    const current = this.repository.findByDefinition(guildId, definition.id);
    if (!current || current.spawnTime !== input.spawnTime) {
      throw new AppError(
        'SCHEDULE_CURRENT_SPAWN_MISMATCH',
        '현재 일정이 변경되었습니다. 새로고침 후 다시 시도해 주세요.',
        409,
      );
    }
    const nextSpawn = current.spawnTime + Math.round(definition.cooldownHours * 3_600_000);
    this.repository.replaceForAction(
      actor,
      { ...input, bossDefinitionId: definition.id, spawnTime: nextSpawn },
      true,
      'SCHEDULE_MUNG',
    );
    return nextSpawn;
  }

  public deleteSchedule(userId: number, guildId: number, scheduleId: number): void {
    const actor = this.requireManager(userId, guildId);
    const schedule = this.repository.findById(guildId, scheduleId);
    if (!schedule) throw new AppError('SCHEDULE_NOT_FOUND', '보스 일정을 찾을 수 없습니다.', 404);
    this.repository.delete(actor, schedule);
  }

  public resetSchedules(userId: number, guildId: number): number {
    return this.repository.resetAll(this.requireManager(userId, guildId));
  }

  public getTargetDefinitionIds(userId: number, guildId: number): number[] {
    this.requireActiveActor(userId, guildId);
    return this.repository.findTargetDefinitionIds(guildId);
  }

  public getTargetBosses(userId: number, guildId: number): string[] {
    const targetIds = new Set(this.getTargetDefinitionIds(userId, guildId));
    return this.bossesService
      .getDefinitions(userId, guildId)
      .filter((definition) => targetIds.has(definition.id))
      .map((definition) => definition.boss);
  }

  public replaceTargetDefinitionIds(userId: number, guildId: number, bossDefinitionIds: number[]): void {
    const actor = this.requireManager(userId, guildId);
    const normalized = [...new Set(bossDefinitionIds)].sort((a, b) => a - b);
    if (normalized.length !== bossDefinitionIds.length) {
      throw new AppError('PARTICIPATION_TARGETS_INVALID', '참여 보스 목록을 확인해 주세요.', 422);
    }
    const knownIds = new Set(
      this.bossesService.getDefinitions(userId, guildId).map((definition) => definition.id),
    );
    if (normalized.some((id) => !knownIds.has(id))) {
      throw new AppError(
        'PARTICIPATION_TARGET_NOT_FOUND',
        '등록되지 않은 보스가 포함되어 있습니다.',
        422,
      );
    }
    this.repository.replaceTargetDefinitionIds(actor, normalized);
  }

  public replaceTargetBosses(userId: number, guildId: number, bosses: string[]): void {
    const normalized = [...new Set(bosses.map((boss) => boss.trim()))].filter(Boolean).sort();
    if (normalized.length !== bosses.length || normalized.some((boss) => boss.includes('|'))) {
      throw new AppError('PARTICIPATION_TARGETS_INVALID', '참여 보스 목록을 확인해 주세요.', 422);
    }
    const definitions = this.bossesService.getDefinitions(userId, guildId);
    const knownNames = new Set(definitions.map((definition) => definition.boss));
    if (normalized.some((boss) => !knownNames.has(boss))) {
      throw new AppError(
        'PARTICIPATION_TARGET_NOT_FOUND',
        '등록되지 않은 보스가 포함되어 있습니다.',
        422,
      );
    }
    this.replaceTargetDefinitionIds(
      userId,
      guildId,
      definitions.filter((definition) => normalized.includes(definition.boss)).map((definition) => definition.id),
    );
  }

  public getParticipants(userId: number, guildId: number): Record<string, string[]> {
    this.requireActiveActor(userId, guildId);
    return this.repository.findParticipants(guildId, this.historyCutoff());
  }

  public getClosedVoteKeys(userId: number, guildId: number): string[] {
    this.requireActiveActor(userId, guildId);
    return this.repository.findClosedVoteKeys(guildId, this.historyCutoff());
  }

  public getVoteOccurrences(
    userId: number,
    guildId: number,
    startMs: number,
    endMs: number,
  ): VoteOccurrence[] {
    this.requireActiveActor(userId, guildId);
    const targetDefinitionIds = this.repository.findTargetDefinitionIds(guildId);
    if (targetDefinitionIds.length === 0) return [];
    const targetSet = new Set(targetDefinitionIds);
    const current = this.repository
      .findAll(guildId)
      .filter(
        (schedule) =>
          targetSet.has(schedule.bossDefinitionId) &&
          schedule.spawnTime >= startMs &&
          schedule.spawnTime <= endMs,
      )
      .map<VoteOccurrence>((schedule) => ({
        id: schedule.id,
        type: schedule.type,
        region: schedule.region,
        boss: schedule.boss,
        spawnTime: schedule.spawnTime,
        isFixed: false,
        isHistory: false,
      }));
    const currentKeys = new Set(current.map((occurrence) => this.voteKey(occurrence)));
    const history = this.repository
      .findHistory(guildId, startMs, endMs, targetDefinitionIds)
      .filter((occurrence) => !currentKeys.has(this.voteKey(occurrence)));
    const fixed = this.buildFixedOccurrences(
      this.bossesService
        .getDefinitions(userId, guildId)
        .filter((definition) => definition.type === '고정' && targetSet.has(definition.id)),
      startMs,
      endMs,
    );
    const unique = new Map<string, VoteOccurrence>();
    [...current, ...history, ...fixed].forEach((occurrence) =>
      unique.set(this.voteKey(occurrence), occurrence),
    );
    return [...unique.values()].sort((a, b) => a.spawnTime - b.spawnTime);
  }

  public toggleParticipation(
    userId: number,
    guildId: number,
    input: ParticipationToggleInput,
  ): boolean {
    const actor = this.requireActiveActor(userId, guildId);
    this.validateInput(input);
    const definition = this.bossesService
      .getDefinitionsByKey(guildId, input)
      .find((candidate) => this.occurrenceExists(guildId, candidate, input.spawnTime));
    if (!definition) {
      throw new AppError('SCHEDULE_NOT_FOUND', '참여할 보스 일정을 찾을 수 없습니다.', 404);
    }
    if (!this.repository.findTargetDefinitionIds(guildId).includes(definition.id)) {
      throw new AppError('PARTICIPATION_NOT_TARGET', '참여 대상 보스가 아닙니다.', 403);
    }
    const voteKey = `${input.type}|${input.region}|${input.boss}|${input.spawnTime}`;
    if (this.repository.isVoteClosed(guildId, voteKey)) {
      throw new AppError('PARTICIPATION_CLOSED', '참여가 마감된 일정입니다.', 409);
    }
    return this.repository.toggleParticipation(actor, voteKey, input.boss, input.spawnTime);
  }

  private resolveInput(guildId: number, input: ScheduleInput): ResolvedScheduleInput {
    this.validateInput(input);
    if (input.type === '고정') {
      throw new AppError(
        'SCHEDULE_FIXED_NOT_STORED',
        '고정 일정은 서버에 직접 저장하지 않습니다.',
        422,
      );
    }
    const definition = this.bossesService.getDefinition(guildId, input);
    if (!definition) throw new AppError('BOSS_NOT_FOUND', '등록된 보스를 찾을 수 없습니다.', 404);
    if (input.bossDefinitionId !== undefined && input.bossDefinitionId !== definition.id) {
      throw new AppError('BOSS_DEFINITION_MISMATCH', '보스 정의 ID가 일정 정보와 일치하지 않습니다.', 422);
    }
    return { ...input, bossDefinitionId: definition.id };
  }

  private requireCooldownDefinition(
    guildId: number,
    key: { type: string; region: string; boss: string },
  ): BossDefinition {
    const definition = this.bossesService.getDefinition(guildId, key);
    if (!definition) throw new AppError('BOSS_NOT_FOUND', '등록된 보스를 찾을 수 없습니다.', 404);
    if (definition.type === '고정' || definition.cooldownHours <= 0) {
      throw new AppError('BOSS_COOLDOWN_MISSING', '보스 쿨타임이 설정되지 않았습니다.', 422);
    }
    return definition;
  }

  private occurrenceExists(
    guildId: number,
    definition: BossDefinition,
    spawnTime: number,
  ): boolean {
    if (definition.type !== '고정') {
      return this.repository.findByDefinition(guildId, definition.id)?.spawnTime === spawnTime;
    }
    if (!definition.timeText || !definition.days) return false;
    const seoul = new Date(spawnTime + 9 * 3_600_000);
    const [hour, minute, second] = definition.timeText.split(':').map(Number);
    return (
      definition.days.split(',').includes(DAY_LABELS[seoul.getUTCDay()] ?? '') &&
      seoul.getUTCHours() === hour &&
      seoul.getUTCMinutes() === minute &&
      seoul.getUTCSeconds() === (second ?? 0)
    );
  }

  private buildFixedOccurrences(
    definitions: BossDefinition[],
    startMs: number,
    endMs: number,
  ): VoteOccurrence[] {
    const startSeoul = new Date(startMs + 9 * 3_600_000);
    const endSeoul = new Date(endMs + 9 * 3_600_000);
    const firstDay = Date.UTC(
      startSeoul.getUTCFullYear(),
      startSeoul.getUTCMonth(),
      startSeoul.getUTCDate(),
    );
    const lastDay = Date.UTC(
      endSeoul.getUTCFullYear(),
      endSeoul.getUTCMonth(),
      endSeoul.getUTCDate(),
    );
    const occurrences: VoteOccurrence[] = [];
    for (let day = firstDay; day <= lastDay; day += 24 * 3_600_000) {
      const date = new Date(day);
      const dayLabel = DAY_LABELS[date.getUTCDay()] ?? '';
      definitions.forEach((definition) => {
        if (!definition.timeText || !definition.days?.split(',').includes(dayLabel)) return;
        const [hour, minute, second = 0] = definition.timeText.split(':').map(Number);
        const spawnTime = Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          hour - 9,
          minute,
          second,
        );
        if (spawnTime < startMs || spawnTime > endMs) return;
        occurrences.push({
          id: null,
          type: definition.type,
          region: definition.region,
          boss: definition.boss,
          spawnTime,
          isFixed: true,
          isHistory: false,
        });
      });
    }
    return occurrences;
  }

  private voteKey(occurrence: {
    type: string;
    region: string;
    boss: string;
    spawnTime: number;
  }): string {
    return `${occurrence.type}|${occurrence.region}|${occurrence.boss}|${occurrence.spawnTime}`;
  }

  private validateInput(input: ScheduleInput): void {
    if (
      !input.type.trim() ||
      !input.region.trim() ||
      !input.boss.trim() ||
      [input.type, input.region, input.boss].some((value) => value.includes('|')) ||
      !Number.isSafeInteger(input.spawnTime) ||
      input.spawnTime < 0 ||
      input.spawnTime > MAX_EPOCH_MS
    ) {
      throw new AppError('SCHEDULE_INVALID', '보스 일정 정보를 확인해 주세요.', 422);
    }
  }

  private requireActiveActor(userId: number, guildId: number): ScheduleActor {
    const actor = this.repository.findActor(userId, guildId);
    if (!actor || !actor.isActive) throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    return actor;
  }

  private requireManager(userId: number, guildId: number): ScheduleActor {
    const actor = this.requireActiveActor(userId, guildId);
    if (actor.role !== 'MASTER' && actor.role !== 'ADMIN') {
      throw new AppError('FORBIDDEN', '보스 일정 관리 권한이 없습니다.', 403);
    }
    return actor;
  }

  private historyCutoff(): number {
    return Date.now() - this.retentionDays * 24 * 3_600_000;
  }
}
