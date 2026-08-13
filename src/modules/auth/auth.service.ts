import bcrypt from 'bcryptjs';

import { AppError } from '../../shared/errors/app-error';
import { classesByOccupation, isValidClassCombination } from './auth.constants';
import { AuthRepository } from './auth.repository';
import type { AuthUser, RegisterInput, RegistrationResult } from './auth.types';

const BCRYPT_ROUNDS = 12;

const hasWhitespace = (value: string): boolean => /\s/.test(value);

const isConstraintError = (error: unknown, fragment: string): boolean =>
  error instanceof Error && error.message.includes(fragment);

export class AuthService {
  public constructor(private readonly repository: AuthRepository) {}

  public async login(username: string, password: string): Promise<AuthUser> {
    const normalizedUsername = username.trim();
    const user = this.repository.findUserByUsername(normalizedUsername);

    if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new AppError('INVALID_CREDENTIALS', '아이디 또는 비밀번호가 올바르지 않습니다.', 401);
    }

    return user;
  }

  public async register(input: RegisterInput): Promise<RegistrationResult> {
    const normalized = this.normalizeRegistration(input);
    this.validateRegistration(normalized);

    if (this.repository.findUserByUsername(normalized.username)) {
      throw new AppError('USERNAME_EXISTS', '이미 사용 중인 아이디입니다.', 409);
    }

    const existingGuild =
      normalized.mode === 'CREATE_GUILD'
        ? this.repository.guildExistsByName(normalized.guild_name)
        : false;
    if (existingGuild) {
      throw new AppError('GUILD_NAME_EXISTS', '이미 사용 중인 길드 이름입니다.', 409);
    }

    const invite =
      normalized.mode === 'JOIN_GUILD' ? this.repository.findInviteByCode(normalized.code) : null;
    if (normalized.mode === 'JOIN_GUILD' && !invite) {
      throw new AppError(
        'INVITE_CODE_INVALID',
        '가입 코드가 올바르지 않거나 현재 길드에서 사용 중이지 않습니다.',
        422,
      );
    }

    const passwordHash = await bcrypt.hash(normalized.password, BCRYPT_ROUNDS);
    const user = {
      username: normalized.username,
      passwordHash,
      nickname: normalized.nickname,
      profile: {
        occupation: normalized.occupation,
        mainClass: normalized.main_class,
        combatPower: normalized.combat_power,
        equipment: normalized.equipment,
        skills: normalized.skills,
      },
    };

    try {
      if (normalized.mode === 'CREATE_GUILD') {
        return this.repository.createGuildWithUser(normalized.guild_name, user);
      }

      return this.repository.createUserInGuild({
        ...user,
        guildId: invite!.guild_id,
        role: invite!.role,
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isConstraintError(error, 'users.username')) {
        throw new AppError('USERNAME_EXISTS', '이미 사용 중인 아이디입니다.', 409);
      }
      if (isConstraintError(error, 'idx_users_username_nocase')) {
        throw new AppError('USERNAME_EXISTS', '이미 사용 중인 아이디입니다.', 409);
      }
      if (isConstraintError(error, 'guilds.name')) {
        throw new AppError('GUILD_NAME_EXISTS', '이미 사용 중인 길드 이름입니다.', 409);
      }
      throw error;
    }
  }

  private normalizeRegistration(input: RegisterInput): RegisterInput & {
    code: string;
    guild_name: string;
  } {
    return {
      ...input,
      code: input.code?.trim().toUpperCase() ?? '',
      guild_name: input.guild_name?.trim() ?? '',
      username: input.username.trim(),
      nickname: input.nickname.trim(),
      occupation: input.occupation.trim(),
      main_class: input.main_class.trim(),
    };
  }

  private validateRegistration(input: RegisterInput & { code: string; guild_name: string }): void {
    if (!input.username || hasWhitespace(input.username)) {
      throw new AppError('VALIDATION_ERROR', '아이디는 공백 없이 입력해야 합니다.', 422, {
        field: 'username',
      });
    }
    if (!input.nickname) {
      throw new AppError('VALIDATION_ERROR', '닉네임을 입력해 주세요.', 422, {
        field: 'nickname',
      });
    }
    if (input.mode === 'CREATE_GUILD' && !input.guild_name) {
      throw new AppError('VALIDATION_ERROR', '길드명을 입력해 주세요.', 422, {
        field: 'guild_name',
      });
    }
    if (input.mode === 'JOIN_GUILD' && !input.code) {
      throw new AppError('VALIDATION_ERROR', '가입 코드를 입력해 주세요.', 422, {
        field: 'code',
      });
    }
    if (!isValidClassCombination(input.occupation, input.main_class)) {
      throw new AppError(
        'INVALID_CLASS_COMBINATION',
        '직업과 주클래스 조합이 올바르지 않습니다.',
        422,
        {
          field: 'main_class',
          occupation: input.occupation,
          allowedClasses: classesByOccupation[input.occupation] ?? [],
        },
      );
    }
  }
}
