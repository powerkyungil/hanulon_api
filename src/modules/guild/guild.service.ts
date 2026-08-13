import { randomBytes } from 'node:crypto';

import { AppError } from '../../shared/errors/app-error';
import { GuildRepository } from './guild.repository';
import type {
  GuildActor,
  GuildInvite,
  GuildSettings,
  GuildSettingsUpdate,
  InviteRole,
} from './guild.types';

const RANDOM_CODE_ATTEMPTS = 10;

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('UNIQUE constraint failed');

export class GuildService {
  public constructor(private readonly repository: GuildRepository) {}

  public getSettings(userId: number, guildId: number): GuildSettings {
    this.requireActiveActor(userId, guildId);
    const settings = this.repository.findSettings(guildId);
    if (!settings) {
      throw new AppError('GUILD_NOT_FOUND', '길드 설정을 찾을 수 없습니다.', 404);
    }
    return settings;
  }

  public updateSettings(userId: number, guildId: number, input: GuildSettingsUpdate): void {
    const actor = this.requireMaster(userId, guildId);
    const current = this.repository.findSettings(guildId);
    if (!current) {
      throw new AppError('GUILD_NOT_FOUND', '길드 설정을 찾을 수 없습니다.', 404);
    }

    const normalized: GuildSettingsUpdate = {
      guildName: input.guildName.trim(),
      allowMemberCombatPowerEdit: input.allowMemberCombatPowerEdit,
    };
    if (!normalized.guildName) {
      throw new AppError('VALIDATION_ERROR', '길드 이름을 입력해 주세요.', 422, {
        field: 'guildName',
      });
    }
    if (this.repository.guildNameExistsForAnotherGuild(guildId, normalized.guildName)) {
      throw new AppError('GUILD_NAME_EXISTS', '이미 사용 중인 길드 이름입니다.', 409);
    }
    if (
      current.guildName === normalized.guildName &&
      current.allowMemberCombatPowerEdit === normalized.allowMemberCombatPowerEdit
    ) {
      return;
    }

    try {
      this.repository.updateSettings(actor, current, normalized);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppError('GUILD_NAME_EXISTS', '이미 사용 중인 길드 이름입니다.', 409);
      }
      throw error;
    }
  }

  public getInvites(userId: number, guildId: number): GuildInvite[] {
    this.requireMaster(userId, guildId);
    return this.repository.findInvites(guildId);
  }

  public saveInvite(
    userId: number,
    guildId: number,
    role: InviteRole,
    customCode?: string,
  ): GuildInvite {
    const actor = this.requireMaster(userId, guildId);
    const normalizedCustomCode = customCode?.trim().toUpperCase();
    const current = this.repository.findInvite(guildId, role);

    if (normalizedCustomCode && current?.inviteCode.toUpperCase() === normalizedCustomCode) {
      return current;
    }

    const inviteCode = normalizedCustomCode || this.generateAvailableCode(role);
    if (normalizedCustomCode && this.repository.inviteCodeExists(inviteCode)) {
      throw new AppError('INVITE_CODE_EXISTS', '이미 사용 중인 가입 코드입니다.', 409);
    }

    try {
      return this.repository.replaceInvite(actor, role, inviteCode, !normalizedCustomCode);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppError('INVITE_CODE_EXISTS', '이미 사용 중인 가입 코드입니다.', 409);
      }
      throw error;
    }
  }

  private generateAvailableCode(role: InviteRole): string {
    for (let attempt = 0; attempt < RANDOM_CODE_ATTEMPTS; attempt += 1) {
      const code = `${role}-${randomBytes(4).toString('hex').toUpperCase()}`;
      if (!this.repository.inviteCodeExists(code)) return code;
    }
    throw new AppError(
      'INVITE_CODE_GENERATION_FAILED',
      '가입 코드를 생성하지 못했습니다. 다시 시도해 주세요.',
      503,
    );
  }

  private requireActiveActor(userId: number, guildId: number): GuildActor {
    const actor = this.repository.findActor(userId, guildId);
    if (!actor || !actor.isActive) {
      throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    }
    return actor;
  }

  private requireMaster(userId: number, guildId: number): GuildActor {
    const actor = this.requireActiveActor(userId, guildId);
    if (actor.role !== 'MASTER') {
      throw new AppError('FORBIDDEN', '길드장만 이 작업을 수행할 수 있습니다.', 403);
    }
    return actor;
  }
}
