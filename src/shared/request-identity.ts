import type { FastifyRequest } from 'fastify';

import { AppError } from './errors/app-error';
import { makeCharacterKey, parseCharacterKey, type CharacterType } from './character-identity';

export interface RequestIdentity {
  userId: number;
  guildId: number;
  accountType: 'USER' | 'DEPUTY' | 'MEMBER_DEPUTY';
  accountId: number;
  accountNickname: string;
  activeCharacterKey: string | null;
  activeCharacterOwnerUserId: number | null;
  activeCharacterType: CharacterType | null;
  activeCharacterName: string | null;
}

export const requestIdentity = (request: FastifyRequest): RequestIdentity => {
  const guildId = request.user.guildId;
  if (!Number.isSafeInteger(guildId) || guildId < 1) {
    throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
  }
  if (request.user.principalType === 'DEPUTY' || request.user.principalType === 'MEMBER_DEPUTY') {
    const accountId = request.user.principalId;
    const userId = request.user.activeCharacterOwnerUserId;
    if (!accountId || !userId || !request.user.activeCharacterKey) {
      throw new AppError(
        'DEPUTY_CHARACTER_REQUIRED',
        '기능을 이용하기 전에 참여할 캐릭터를 선택해 주세요.',
        409,
      );
    }
    return {
      userId,
      guildId,
      accountType: request.user.principalType === 'MEMBER_DEPUTY' ? 'MEMBER_DEPUTY' : 'DEPUTY',
      accountId,
      accountNickname:
        request.user.principalType === 'MEMBER_DEPUTY'
          ? (request.user.actorNickname ?? request.user.nickname)
          : request.user.nickname,
      activeCharacterKey: request.user.activeCharacterKey,
      activeCharacterOwnerUserId: userId,
      activeCharacterType: request.user.activeCharacterType ?? null,
      activeCharacterName: request.user.activeCharacterName ?? null,
    };
  }

  const userId = Number(request.user.sub);
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
  }
  return {
    userId,
    guildId,
    accountType: 'USER',
    accountId: userId,
    accountNickname: request.user.nickname,
    activeCharacterKey: null,
    activeCharacterOwnerUserId: null,
    activeCharacterType: null,
    activeCharacterName: null,
  };
};

export const resolveCharacterKey = (
  identity: RequestIdentity,
  requestedCharacterKey?: string,
): string => {
  if (identity.accountType !== 'USER') {
    if (requestedCharacterKey && requestedCharacterKey !== identity.activeCharacterKey) {
      throw new AppError(
        'DEPUTY_CHARACTER_MISMATCH',
        '선택한 캐릭터로만 부주 기능을 사용할 수 있습니다.',
        403,
      );
    }
    return identity.activeCharacterKey!;
  }
  if (requestedCharacterKey) {
    if (!parseCharacterKey(requestedCharacterKey)) {
      throw new AppError('CHARACTER_INVALID', '투표할 캐릭터를 확인해 주세요.', 422);
    }
    return requestedCharacterKey;
  }
  return makeCharacterKey('MAIN', identity.userId);
};
