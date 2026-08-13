import { AppError } from '../../shared/errors/app-error';
import { BossesRepository } from './bosses.repository';
import type { BossActor, BossDefinition, BossDefinitionInput, BossKey } from './bosses.types';

const DAY_LABELS = new Set(['월', '화', '수', '목', '금', '토', '일']);
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export class BossesService {
  public constructor(private readonly repository: BossesRepository) {}

  public getDefinitions(userId: number, guildId: number): BossDefinition[] {
    this.requireActiveActor(userId, guildId);
    this.ensureDefinitions(guildId);
    return this.repository.findAll(guildId);
  }

  public ensureDefinitions(guildId: number): void {
    this.repository.ensureDefaults(guildId);
  }

  public getDefinition(guildId: number, key: BossKey): BossDefinition | null {
    this.ensureDefinitions(guildId);
    return this.repository.findByKey(guildId, key);
  }

  public getDefinitionsByKey(guildId: number, key: BossKey): BossDefinition[] {
    this.ensureDefinitions(guildId);
    return this.repository.findAllByKey(guildId, key);
  }

  public createDefinition(
    userId: number,
    guildId: number,
    input: BossDefinitionInput,
  ): BossDefinition {
    const actor = this.requireManager(userId, guildId);
    this.repository.ensureDefaults(guildId);
    const normalized = this.normalizeInput(input);
    if (this.repository.exactDefinitionExists(guildId, normalized)) {
      throw new AppError('BOSS_DEFINITION_EXISTS', '이미 등록된 보스 정의입니다.', 409);
    }
    const id = this.repository.create(actor, normalized);
    return this.requireDefinition(guildId, id);
  }

  public deleteDefinition(userId: number, guildId: number, id: number): void {
    const actor = this.requireManager(userId, guildId);
    this.repository.ensureDefaults(guildId);
    this.repository.delete(actor, this.requireDefinition(guildId, id));
  }

  public reorderByIds(userId: number, guildId: number, ids: number[]): void {
    const actor = this.requireManager(userId, guildId);
    this.repository.ensureDefaults(guildId);
    const currentIds = this.repository.findAll(guildId).map((definition) => definition.id);
    if (
      ids.length !== currentIds.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !currentIds.includes(id))
    ) {
      throw new AppError(
        'BOSS_ORDER_INVALID',
        '현재 길드의 모든 보스 ID를 중복 없이 전달해야 합니다.',
        422,
      );
    }
    this.repository.reorderByIds(actor, ids);
  }

  public reorderByBossNames(
    userId: number,
    guildId: number,
    orderList: Array<{ boss: string; sortOrder: number }>,
  ): void {
    const actor = this.requireManager(userId, guildId);
    this.repository.ensureDefaults(guildId);
    const names = new Set(this.repository.findAll(guildId).map((definition) => definition.boss));
    if (orderList.some((item) => !names.has(item.boss.trim()))) {
      throw new AppError('BOSS_ORDER_INVALID', '다른 길드이거나 존재하지 않는 보스입니다.', 422);
    }
    this.repository.reorderByBossNames(
      actor,
      orderList.map((item) => ({ boss: item.boss.trim(), sortOrder: item.sortOrder })),
    );
  }

  public resetDefinitions(userId: number, guildId: number): void {
    const actor = this.requireManager(userId, guildId);
    this.repository.ensureDefaults(guildId);
    this.repository.reset(actor);
  }

  private normalizeInput(input: BossDefinitionInput): BossDefinitionInput {
    const type = input.type.trim();
    const region = input.region.trim() || '공통';
    const boss = input.boss.trim();
    if (!type || !region || !boss || [type, region, boss].some((value) => value.includes('|'))) {
      throw new AppError('BOSS_DEFINITION_INVALID', '보스 유형·지역·이름을 확인해 주세요.', 422);
    }
    const color = input.color?.trim() || null;
    if (color && !COLOR_PATTERN.test(color)) {
      throw new AppError('BOSS_COLOR_INVALID', '색상은 #RRGGBB 형식이어야 합니다.', 422);
    }
    if (type === '고정') {
      const timeText = input.timeText?.trim() ?? '';
      const days = (input.days ?? '')
        .split(',')
        .map((day) => day.trim())
        .filter(Boolean);
      if (
        !TIME_PATTERN.test(timeText) ||
        days.length === 0 ||
        days.some((day) => !DAY_LABELS.has(day))
      ) {
        throw new AppError(
          'BOSS_FIXED_SCHEDULE_INVALID',
          '고정 보스의 시각과 요일을 확인해 주세요.',
          422,
        );
      }
      return {
        type,
        region,
        boss,
        cooldownHours: 0,
        timeText: timeText.length === 5 ? `${timeText}:00` : timeText,
        days: [...new Set(days)].join(','),
        color,
      };
    }
    return {
      type,
      region,
      boss,
      cooldownHours: input.cooldownHours,
      timeText: null,
      days: null,
      color,
    };
  }

  private requireActiveActor(userId: number, guildId: number): BossActor {
    const actor = this.repository.findActor(userId, guildId);
    if (!actor || !actor.isActive) throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    return actor;
  }

  private requireManager(userId: number, guildId: number): BossActor {
    const actor = this.requireActiveActor(userId, guildId);
    if (actor.role !== 'MASTER' && actor.role !== 'ADMIN') {
      throw new AppError('FORBIDDEN', '보스 관리 권한이 없습니다.', 403);
    }
    return actor;
  }

  private requireDefinition(guildId: number, id: number): BossDefinition {
    const definition = this.repository.findById(guildId, id);
    if (!definition) throw new AppError('BOSS_NOT_FOUND', '보스를 찾을 수 없습니다.', 404);
    return definition;
  }
}
