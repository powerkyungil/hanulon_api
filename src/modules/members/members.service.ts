import bcrypt from 'bcryptjs';

import { AppError } from '../../shared/errors/app-error';
import {
  equipmentGrades,
  equipmentParts,
  isValidClassCombination,
  isValidMainClass,
  skillLevels,
  skillNames,
} from '../auth/auth.constants';
import { MembersRepository } from './members.repository';
import type { ProfileIdentity, ProfileUpdateInput, UserProfile } from './members.types';

const BCRYPT_ROUNDS = 12;
const RESET_PASSWORD = '1234';

const hasWhitespace = (value: string): boolean => /\s/.test(value);
const isOneOf = <T extends string>(value: string, values: readonly T[]): boolean =>
  values.includes(value as T);

export class MembersService {
  public constructor(private readonly repository: MembersRepository) {}

  public getMe(userId: number, guildId: number): UserProfile {
    const profile = this.repository.findProfile(userId, guildId);
    if (!profile) {
      throw new AppError('USER_NOT_FOUND', '사용자 정보를 찾을 수 없습니다.', 404);
    }
    return profile;
  }

  public getMembers(userId: number, guildId: number): UserProfile[] {
    this.requireActiveActor(userId, guildId);
    return this.repository.findProfilesByGuild(guildId);
  }

  public async updateMe(userId: number, guildId: number, input: ProfileUpdateInput): Promise<void> {
    const identity = this.repository.findIdentity(userId, guildId);
    if (!identity || !identity.isActive) {
      throw new AppError('USER_NOT_FOUND', '사용자 정보를 찾을 수 없습니다.', 404);
    }

    const current = this.getMe(userId, guildId);
    const settings = this.repository.findGuildProfileSettings(guildId);
    if (!settings) {
      throw new AppError('GUILD_NOT_FOUND', '길드 설정을 찾을 수 없습니다.', 404);
    }

    this.validateProfile(input);

    if (
      identity.role === 'MEMBER' &&
      !settings.allowMemberCombatPowerEdit &&
      input.combatPower !== current.combatPower
    ) {
      throw new AppError(
        'COMBAT_POWER_EDIT_FORBIDDEN',
        '현재 길드 설정상 전투력을 수정할 수 없습니다.',
        403,
      );
    }

    const passwordHash = input.password ? await bcrypt.hash(input.password, BCRYPT_ROUNDS) : null;
    this.repository.updateProfile(identity, input, passwordHash);
  }

  public changeRole(
    actorUserId: number,
    guildId: number,
    targetUserId: number,
    role: 'MEMBER' | 'ADMIN',
  ): void {
    const actor = this.requireActiveActor(actorUserId, guildId);
    this.requireRole(actor, ['MASTER']);
    const target = this.requireActiveTarget(targetUserId, guildId);
    if (target.role === 'MASTER') {
      throw new AppError(
        'MASTER_ROLE_CHANGE_FORBIDDEN',
        '길드장의 역할은 변경할 수 없습니다.',
        409,
      );
    }
    if (target.role === role) return;
    this.repository.changeRole(actor, target, role);
  }

  public transferMaster(actorUserId: number, guildId: number, targetUserId: number): void {
    const actor = this.requireActiveActor(actorUserId, guildId);
    this.requireRole(actor, ['MASTER']);
    if (actor.id === targetUserId) {
      throw new AppError(
        'MASTER_TRANSFER_TARGET_INVALID',
        '현재 길드장에게 위임할 수 없습니다.',
        409,
      );
    }
    const target = this.requireActiveTarget(targetUserId, guildId);
    if (target.role === 'MASTER') {
      throw new AppError('MASTER_TRANSFER_TARGET_INVALID', '위임 대상을 확인해 주세요.', 409);
    }
    this.repository.transferMaster(actor, target);
  }

  public async resetPassword(
    actorUserId: number,
    guildId: number,
    targetUserId: number,
  ): Promise<void> {
    const actor = this.requireActiveActor(actorUserId, guildId);
    this.requireRole(actor, ['MASTER', 'ADMIN']);
    const target = this.requireActiveTarget(targetUserId, guildId);
    if (actor.role === 'ADMIN' && target.role === 'MASTER') {
      throw new AppError(
        'MASTER_PASSWORD_RESET_FORBIDDEN',
        '운영진은 길드장의 비밀번호를 초기화할 수 없습니다.',
        403,
      );
    }
    const passwordHash = await bcrypt.hash(RESET_PASSWORD, BCRYPT_ROUNDS);
    this.repository.resetPassword(actor, target, passwordHash);
  }

  public removeMember(actorUserId: number, guildId: number, targetUserId: number): void {
    const actor = this.requireActiveActor(actorUserId, guildId);
    this.requireRole(actor, ['MASTER']);
    const target = this.requireActiveTarget(targetUserId, guildId);
    if (target.role === 'MASTER') {
      throw new AppError('MASTER_REMOVE_FORBIDDEN', '길드장은 강퇴할 수 없습니다.', 409);
    }
    this.repository.removeMember(actor, target);
  }

  private validateProfile(input: ProfileUpdateInput): void {
    if (!input.nickname || hasWhitespace(input.nickname)) {
      throw new AppError('VALIDATION_ERROR', '닉네임은 공백 없이 입력해야 합니다.', 422, {
        field: 'nickname',
      });
    }
    if (!isValidClassCombination(input.occupation, input.mainClass)) {
      throw new AppError(
        'INVALID_CLASS_COMBINATION',
        '직업과 주클래스 조합이 올바르지 않습니다.',
        422,
        {
          field: 'mainClass',
        },
      );
    }
    if (!Number.isInteger(input.combatPower) || input.combatPower < 0) {
      throw new AppError('VALIDATION_ERROR', '전투력은 0 이상의 정수여야 합니다.', 422, {
        field: 'combatPower',
      });
    }
    for (const value of [input.maxCritRate, input.maxCritResist, input.statusEffectAcc]) {
      if (!Number.isFinite(value) || value < 0) {
        throw new AppError('VALIDATION_ERROR', '능력치는 0 이상의 숫자여야 합니다.', 422);
      }
    }

    for (const [part, item] of Object.entries(input.equipment)) {
      if (!isOneOf(part, equipmentParts) || !isOneOf(item.color, equipmentGrades)) {
        throw new AppError('VALIDATION_ERROR', '장비 정보가 올바르지 않습니다.', 422, {
          field: 'equipment',
        });
      }
    }

    for (const skillMap of [input.skills.active, input.skills.passive]) {
      for (const [name, level] of Object.entries(skillMap)) {
        if (!isOneOf(name, skillNames) || !isOneOf(level, skillLevels)) {
          throw new AppError('VALIDATION_ERROR', '스킬 정보가 올바르지 않습니다.', 422, {
            field: 'skills',
          });
        }
      }
    }

    for (const alternate of input.alternateCharacters) {
      if (
        !alternate.characterName.trim() ||
        !isValidMainClass(alternate.mainClass) ||
        hasWhitespace(alternate.characterName)
      ) {
        throw new AppError('VALIDATION_ERROR', '부계정 정보가 올바르지 않습니다.', 422, {
          field: 'alternateCharacters',
        });
      }
    }
  }

  private requireActiveActor(userId: number, guildId: number): ProfileIdentity {
    const actor = this.repository.findIdentity(userId, guildId);
    if (!actor || !actor.isActive) {
      throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    }
    return actor;
  }

  private requireActiveTarget(userId: number, guildId: number): ProfileIdentity {
    const target = this.repository.findIdentity(userId, guildId);
    if (!target || !target.isActive) {
      throw new AppError('MEMBER_NOT_FOUND', '길드원을 찾을 수 없습니다.', 404);
    }
    return target;
  }

  private requireRole(actor: ProfileIdentity, roles: ProfileIdentity['role'][]): void {
    if (!roles.includes(actor.role)) {
      throw new AppError('FORBIDDEN', '이 작업을 수행할 권한이 없습니다.', 403);
    }
  }
}
