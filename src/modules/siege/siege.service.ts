import { AppError } from '../../shared/errors/app-error';
import { SiegeRepository } from './siege.repository';
import type { SiegeActor, SiegeInput, SiegeRecord } from './siege.types';

const MAX_DIAMONDS = 999_999_999;

export class SiegeService {
  public constructor(private readonly repository: SiegeRepository) {}

  public getRecords(userId: number, guildId: number): SiegeRecord[] {
    this.requireActiveActor(userId, guildId);
    return this.repository.findRecords(guildId);
  }

  public saveMine(userId: number, guildId: number, input: SiegeInput): void {
    const actor = this.requireActiveActor(userId, guildId);
    this.validateInput(input);
    this.repository.saveRecord(actor, actor.id, input);
  }

  public saveMember(
    userId: number,
    guildId: number,
    targetUserId: number,
    input: SiegeInput,
  ): void {
    const actor = this.requireManager(userId, guildId);
    this.requireActiveTarget(targetUserId, guildId);
    this.validateInput(input);
    this.repository.saveRecord(actor, targetUserId, input);
  }

  public resetAll(userId: number, guildId: number): number {
    const actor = this.requireManager(userId, guildId);
    return this.repository.resetAll(actor);
  }

  private validateInput(input: SiegeInput): void {
    const values = [input.currentDiamonds, input.remainingDiamonds];
    if (values.some((value) => !Number.isSafeInteger(value) || value < 0 || value > MAX_DIAMONDS)) {
      throw new AppError(
        'SIEGE_DIAMONDS_INVALID',
        '다이아는 0 이상 999,999,999 이하의 정수여야 합니다.',
        422,
      );
    }
    if (input.remainingDiamonds > input.currentDiamonds) {
      throw new AppError(
        'SIEGE_REMAINING_EXCEEDS_CURRENT',
        '종료 후 다이아는 시작 전 다이아보다 클 수 없습니다.',
        422,
      );
    }
  }

  private requireActiveActor(userId: number, guildId: number): SiegeActor {
    const actor = this.repository.findActor(userId, guildId);
    if (!actor || !actor.isActive) {
      throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    }
    return actor;
  }

  private requireManager(userId: number, guildId: number): SiegeActor {
    const actor = this.requireActiveActor(userId, guildId);
    if (actor.role !== 'MASTER' && actor.role !== 'ADMIN') {
      throw new AppError('FORBIDDEN', '공성전 현황 관리 권한이 없습니다.', 403);
    }
    return actor;
  }

  private requireActiveTarget(userId: number, guildId: number): SiegeActor {
    const target = this.repository.findActor(userId, guildId);
    if (!target || !target.isActive) {
      throw new AppError('SIEGE_MEMBER_NOT_FOUND', '길드원을 찾을 수 없습니다.', 404);
    }
    return target;
  }
}
