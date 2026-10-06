import bcrypt from 'bcryptjs';

import { AppError } from '../../shared/errors/app-error';
import { parseCharacterKey } from '../../shared/character-identity';
import type { UserRole } from '../auth/auth.types';
import { DeputyAccountsRepository } from './deputy-accounts.repository';
import type {
  DeputyAccount,
  DeputyAccountCredentials,
  DeputyCharacter,
} from './deputy-accounts.types';

const BCRYPT_ROUNDS = 12;

export class DeputyAccountsService {
  public constructor(private readonly repository: DeputyAccountsRepository) {}

  public async login(username: string, password: string): Promise<DeputyAccountCredentials> {
    const account = this.repository.findCredentialsByUsername(username.trim());
    if (!account || !account.isActive || !(await bcrypt.compare(password, account.passwordHash))) {
      throw new AppError('INVALID_CREDENTIALS', '아이디 또는 비밀번호가 올바르지 않습니다.', 401);
    }
    return account;
  }

  public listAccounts(actorUserId: number, guildId: number): DeputyAccount[] {
    this.requireManager(actorUserId, guildId);
    return this.repository.findAccounts(guildId);
  }

  public async createAccount(
    actorUserId: number,
    guildId: number,
    input: { username: string; password: string; nickname: string },
  ): Promise<number> {
    this.requireManager(actorUserId, guildId);
    const username = input.username.trim();
    const nickname = input.nickname.trim();
    if (!username || /\s/.test(username) || !nickname) {
      throw new AppError('DEPUTY_ACCOUNT_INVALID', '부주 계정 정보를 확인해 주세요.', 422);
    }
    if (this.repository.usernameExists(username)) {
      throw new AppError('USERNAME_EXISTS', '이미 사용 중인 아이디입니다.', 409);
    }
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    try {
      return this.repository.createAccount(guildId, actorUserId, username, passwordHash, nickname);
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new AppError('USERNAME_EXISTS', '이미 사용 중인 아이디입니다.', 409);
      }
      throw error;
    }
  }

  public async updatePassword(
    actorUserId: number,
    guildId: number,
    deputyId: number,
    password: string,
  ): Promise<void> {
    this.requireManager(actorUserId, guildId);
    this.requireAccount(guildId, deputyId);
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    this.repository.updatePassword(guildId, actorUserId, deputyId, passwordHash);
  }

  public setActive(
    actorUserId: number,
    guildId: number,
    deputyId: number,
    isActive: boolean,
  ): void {
    this.requireManager(actorUserId, guildId);
    this.requireAccount(guildId, deputyId);
    this.repository.setActive(guildId, actorUserId, deputyId, isActive);
  }

  public getCharacters(guildId: number): DeputyCharacter[] {
    return this.repository.findCharacters(guildId);
  }

  public getProfile(
    deputyId: number,
    guildId: number,
  ): {
    deputyId: number;
    username: string;
    nickname: string;
  } {
    const account = this.requireAccount(guildId, deputyId);
    return { deputyId: account.id, username: account.username, nickname: account.nickname };
  }

  public updateNickname(
    deputyId: number,
    guildId: number,
    nickname: string,
  ): {
    deputyId: number;
    username: string;
    nickname: string;
  } {
    const account = this.requireAccount(guildId, deputyId);
    if (!account.isActive) {
      throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    }
    const normalizedNickname = nickname.trim();
    if (!normalizedNickname || normalizedNickname.length > 40) {
      throw new AppError('DEPUTY_NICKNAME_INVALID', '닉네임은 1~40자로 입력해 주세요.', 422);
    }
    this.repository.updateNickname(guildId, deputyId, normalizedNickname);
    return { deputyId: account.id, username: account.username, nickname: normalizedNickname };
  }

  public getActiveCharacter(deputyId: number, guildId: number): DeputyCharacter | null {
    const account = this.requireAccount(guildId, deputyId);
    if (!account.isActive || !account.activeCharacterKey) return null;
    return (
      this.repository
        .findCharacters(guildId)
        .find((character) => character.characterKey === account.activeCharacterKey) ?? null
    );
  }

  public selectActiveCharacter(
    deputyId: number,
    guildId: number,
    characterKey: string,
  ): DeputyCharacter {
    const account = this.requireAccount(guildId, deputyId);
    if (!account.isActive) {
      throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    }
    if (!parseCharacterKey(characterKey)) {
      throw new AppError('DEPUTY_CHARACTER_INVALID', '선택할 캐릭터를 확인해 주세요.', 422);
    }
    const character = this.repository
      .findCharacters(guildId)
      .find((candidate) => candidate.characterKey === characterKey);
    if (!character) {
      throw new AppError(
        'DEPUTY_CHARACTER_NOT_FOUND',
        '같은 길드의 캐릭터를 찾을 수 없습니다.',
        404,
      );
    }
    this.repository.selectCharacter(deputyId, guildId, characterKey);
    return character;
  }

  private requireManager(userId: number, guildId: number): void {
    const actor = this.repository.findActor(userId, guildId);
    if (!actor || !actor.isActive) {
      throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    }
    if (!(['MASTER', 'ADMIN'] as UserRole[]).includes(actor.role)) {
      throw new AppError('FORBIDDEN', '부주 계정을 관리할 권한이 없습니다.', 403);
    }
  }

  private requireAccount(guildId: number, deputyId: number): DeputyAccount {
    const account = this.repository.findAccount(guildId, deputyId);
    if (!account) {
      throw new AppError('DEPUTY_ACCOUNT_NOT_FOUND', '부주 계정을 찾을 수 없습니다.', 404);
    }
    return account;
  }
}
