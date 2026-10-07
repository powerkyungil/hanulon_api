import { AppError } from '../../shared/errors/app-error';
import { findCharacterIdentity } from '../../shared/character-identity';
import { MemberDelegationsRepository } from './member-delegations.repository';
import type {
  DelegationUser,
  MemberDelegation,
  MemberDelegationLists,
  MemberDelegationSession,
} from './member-delegations.types';

export class MemberDelegationsService {
  public constructor(
    private readonly repository: MemberDelegationsRepository,
    private readonly db: Parameters<typeof findCharacterIdentity>[0],
  ) {}

  public list(userId: number, guildId: number): MemberDelegationLists {
    this.requireActiveMember(userId, guildId);
    return this.repository.findLists(guildId, userId);
  }

  public grant(userId: number, guildId: number, deputyUserId: number): MemberDelegation {
    const owner = this.requireActiveMember(userId, guildId);
    if (owner.id === deputyUserId) {
      throw new AppError(
        'MEMBER_DELEGATION_SELF_FORBIDDEN',
        '본인 계정은 자신의 부주로 지정할 수 없습니다.',
        422,
      );
    }
    this.requireActiveMember(deputyUserId, guildId);
    try {
      return this.repository.grant(guildId, owner.id, deputyUserId);
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new AppError('MEMBER_DELEGATION_EXISTS', '이미 등록된 부주 관계입니다.', 409);
      }
      throw error;
    }
  }

  public revoke(userId: number, guildId: number, deputyUserId: number): void {
    const owner = this.requireActiveMember(userId, guildId);
    if (!this.repository.revoke(guildId, owner.id, deputyUserId)) {
      throw new AppError(
        'MEMBER_DELEGATION_NOT_FOUND',
        '활성화된 부주 관계를 찾을 수 없습니다.',
        404,
      );
    }
  }

  public createSession(
    deputyUserId: number,
    guildId: number,
    ownerUserId: number,
    characterKey?: string,
  ): MemberDelegationSession {
    const deputy = this.requireActiveMember(deputyUserId, guildId);
    const owner = this.requireActiveMember(ownerUserId, guildId);
    if (owner.id === deputy.id) {
      throw new AppError(
        'MEMBER_DELEGATION_SELF_FORBIDDEN',
        '본인 계정으로는 부주 세션을 만들 수 없습니다.',
        422,
      );
    }

    const delegation = this.repository.findDelegation(guildId, owner.id, deputy.id);
    if (!delegation?.isActive) {
      throw new AppError('MEMBER_DELEGATION_FORBIDDEN', '해당 회원의 부주 권한이 없습니다.', 403);
    }

    const resolvedCharacterKey = characterKey ?? `MAIN:${owner.id}`;
    const activeCharacter = findCharacterIdentity(this.db, guildId, resolvedCharacterKey);
    if (!activeCharacter || activeCharacter.ownerUserId !== owner.id) {
      throw new AppError(
        'MEMBER_DELEGATION_CHARACTER_NOT_FOUND',
        '부주 대상 회원의 캐릭터를 찾을 수 없습니다.',
        404,
      );
    }

    return { owner, deputy, activeCharacter };
  }

  private requireActiveMember(userId: number, guildId: number): DelegationUser {
    const user = this.repository.findUser(userId, guildId);
    if (!user || !user.isActive) {
      throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    }
    if (user.role !== 'MEMBER') {
      throw new AppError(
        'MEMBER_DELEGATION_MEMBER_ONLY',
        '일반 MEMBER끼리만 부주 관계를 만들 수 있습니다.',
        403,
      );
    }
    return user;
  }
}
