import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AppConfig } from '../config/env';
import { AuthRepository } from '../modules/auth/auth.repository';
import { findCharacterIdentity } from '../shared/character-identity';
import { AppError } from '../shared/errors/app-error';

export interface AuthenticatedUser {
  sub: string;
  guildId: number;
  role: 'MASTER' | 'ADMIN' | 'MEMBER' | 'DEPUTY';
  username: string;
  nickname: string;
  principalType?: 'USER' | 'DEPUTY' | 'MEMBER_DEPUTY';
  principalId?: number;
  delegatedUserId?: number;
  actorUsername?: string;
  actorNickname?: string;
  tokenVersion?: number;
  activeCharacterKey?: string | null;
  activeCharacterOwnerUserId?: number | null;
  activeCharacterType?: 'MAIN' | 'ALTERNATE' | null;
  activeCharacterName?: string | null;
}

interface LegacyAuthenticatedUser extends Partial<AuthenticatedUser> {
  id?: number;
}

interface DeputyAccountAuthRow {
  id: number;
  guild_id: number;
  username: string;
  nickname: string;
  is_active: number;
  active_character_key: string | null;
  token_version: number;
}

interface MemberDelegationAuthRow {
  owner_id: number;
  owner_guild_id: number;
  owner_username: string;
  owner_nickname: string;
  deputy_id: number;
  deputy_username: string;
  deputy_nickname: string;
}

const isRestrictedPrincipalRouteAllowed = (method: string, rawUrl: string): boolean => {
  const path = rawUrl.split('?')[0];
  if (path === '/api/v1/deputy/me') return method === 'GET' || method === 'PUT';
  if (path === '/api/v1/deputy/characters' || path === '/api/v1/deputy/active-character') {
    return method === 'GET' || (path.endsWith('/active-character') && method === 'PUT');
  }

  if (path === '/api/v1/schedules' || path === '/api/schedules') return method === 'GET';
  if (path === '/api/v1/bosses') return method === 'GET';
  if (
    path === '/api/v1/participants' ||
    path === '/api/participants' ||
    path === '/api/v1/participation-targets' ||
    path === '/api/participation-targets' ||
    path === '/api/v1/participation-states' ||
    path === '/api/participation-states'
  ) {
    return method === 'GET';
  }
  if (/^\/api\/v1\/participants\/[^/]+$/.test(path)) return method === 'PUT';
  if (/^\/api\/participants\/[^/]+$/.test(path)) return method === 'POST';
  if (path === '/api/v1/boss-votes' || path === '/api/vote-bosses') return method === 'GET';
  if (/^\/api\/v1\/boss-votes\/[^/]+\/participation$/.test(path)) return method === 'PUT';
  if (/^\/api\/vote-participants\/[^/]+$/.test(path)) return method === 'POST';
  if (path === '/api/v1/support-requests' || path === '/api/support-requests') {
    return method === 'GET' || method === 'POST';
  }
  if (
    /^\/api\/(?:v1\/)?support-requests\/\d+(?:\/applications(?:\/\d+)?|\/select\/\d+|\/status)?$/.test(
      path,
    )
  ) {
    return ['POST', 'DELETE', 'PUT'].includes(method);
  }
  if (path === '/api/v1/content-groups/roster') return method === 'GET';
  if (path === '/api/v1/content-groups' || path === '/api/groups') return method === 'GET';
  return false;
};

declare module 'fastify' {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthenticatedUser;
    user: AuthenticatedUser;
  }
}

export const registerAuth = async (app: FastifyInstance, config: AppConfig): Promise<void> => {
  await app.register(fastifyJwt, {
    secret: config.jwtSecret,
    sign: {
      expiresIn: '7d',
    },
  });

  const repository = new AuthRepository(app.db);

  const normalizeUser = (request: FastifyRequest): void => {
    const payload = request.user as LegacyAuthenticatedUser;
    const isDeputy = payload.principalType === 'DEPUTY';
    const isMemberDeputy = payload.principalType === 'MEMBER_DEPUTY';
    const principalId = Number(payload.sub ?? payload.id);
    if (!Number.isSafeInteger(principalId) || principalId < 1) {
      throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    }

    if (isDeputy) {
      const account = app.db
        .prepare(
          `
            SELECT id, guild_id, username, nickname, is_active, active_character_key, token_version
            FROM deputy_accounts
            WHERE id = ?
            LIMIT 1
          `,
        )
        .get(principalId) as DeputyAccountAuthRow | undefined;
      if (!account || account.is_active !== 1 || payload.tokenVersion !== account.token_version) {
        throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
      }

      let activeCharacterOwnerUserId: number | null = null;
      let activeCharacterType: 'MAIN' | 'ALTERNATE' | null = null;
      let activeCharacterName: string | null = null;
      const characterMatch = /^(MAIN|ALTERNATE):([1-9]\d*)$/.exec(
        account.active_character_key ?? '',
      );
      const ownerUserId = Number(characterMatch?.[2]);
      if (characterMatch && Number.isSafeInteger(ownerUserId)) {
        const character =
          characterMatch[1] === 'MAIN'
            ? (app.db
                .prepare(
                  `
                    SELECT u.id, u.nickname AS character_name
                    FROM users AS u
                    WHERE u.id = ? AND u.guild_id = ? AND u.is_active = 1
                    LIMIT 1
                  `,
                )
                .get(ownerUserId, account.guild_id) as
                { id: number; character_name: string } | undefined)
            : (app.db
                .prepare(
                  `
                    SELECT u.id, ac.character_name
                    FROM alternate_characters AS ac
                    JOIN users AS u ON u.id = ac.user_id
                    WHERE u.id = ? AND u.guild_id = ? AND u.is_active = 1
                    LIMIT 1
                  `,
                )
                .get(ownerUserId, account.guild_id) as
                { id: number; character_name: string } | undefined);
        if (character) {
          activeCharacterOwnerUserId = character.id;
          activeCharacterType = characterMatch[1] as 'MAIN' | 'ALTERNATE';
          activeCharacterName = character.character_name;
        }
      }

      if (!isRestrictedPrincipalRouteAllowed(request.method, request.url)) {
        throw new AppError(
          'DEPUTY_FEATURE_FORBIDDEN',
          '부주 계정으로 사용할 수 없는 기능입니다.',
          403,
        );
      }
      if (
        !activeCharacterOwnerUserId &&
        request.url.split('?')[0] !== '/api/v1/deputy/characters' &&
        request.url.split('?')[0] !== '/api/v1/deputy/active-character' &&
        request.url.split('?')[0] !== '/api/v1/deputy/me'
      ) {
        throw new AppError(
          'DEPUTY_CHARACTER_REQUIRED',
          '기능을 이용하기 전에 참여할 캐릭터를 선택해 주세요.',
          409,
        );
      }

      request.user = {
        sub: String(activeCharacterOwnerUserId ?? 0),
        guildId: account.guild_id,
        role: 'DEPUTY',
        username: account.username,
        nickname: account.nickname,
        principalType: 'DEPUTY',
        principalId: account.id,
        activeCharacterKey: activeCharacterOwnerUserId ? account.active_character_key : null,
        activeCharacterOwnerUserId,
        activeCharacterType,
        activeCharacterName,
      };
      return;
    }

    if (isMemberDeputy) {
      const deputyUserId = Number(payload.principalId);
      const ownerUserId = Number(payload.delegatedUserId ?? payload.sub);
      const guildId = Number(payload.guildId);
      if (
        !Number.isSafeInteger(deputyUserId) ||
        deputyUserId < 1 ||
        !Number.isSafeInteger(ownerUserId) ||
        ownerUserId < 1 ||
        !Number.isSafeInteger(guildId) ||
        guildId < 1
      ) {
        throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
      }

      const delegation = app.db
        .prepare(
          `
              SELECT
                owner.id AS owner_id,
                owner.guild_id AS owner_guild_id,
                owner.username AS owner_username,
                owner.nickname AS owner_nickname,
                deputy.id AS deputy_id,
                deputy.username AS deputy_username,
                deputy.nickname AS deputy_nickname
              FROM member_delegations AS delegation
              JOIN users AS owner ON owner.id = delegation.owner_user_id
              JOIN users AS deputy ON deputy.id = delegation.deputy_user_id
              WHERE delegation.guild_id = ?
                AND delegation.owner_user_id = ?
                AND delegation.deputy_user_id = ?
                AND delegation.is_active = 1
                AND owner.guild_id = delegation.guild_id
                AND deputy.guild_id = delegation.guild_id
                AND owner.role = 'MEMBER'
                AND deputy.role = 'MEMBER'
                AND owner.is_active = 1
                AND deputy.is_active = 1
              LIMIT 1
            `,
        )
        .get(guildId, ownerUserId, deputyUserId) as MemberDelegationAuthRow | undefined;
      if (!delegation) {
        throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
      }

      if (!isRestrictedPrincipalRouteAllowed(request.method, request.url)) {
        throw new AppError(
          'DEPUTY_FEATURE_FORBIDDEN',
          '부주 계정으로 사용할 수 없는 기능입니다.',
          403,
        );
      }

      const activeCharacterKey = payload.activeCharacterKey ?? null;
      const activeCharacter = activeCharacterKey
        ? findCharacterIdentity(app.db, guildId, activeCharacterKey)
        : null;
      if (!activeCharacter || activeCharacter.ownerUserId !== delegation.owner_id) {
        throw new AppError(
          'DEPUTY_CHARACTER_REQUIRED',
          '기능을 이용하기 전에 참여할 캐릭터를 선택해 주세요.',
          409,
        );
      }

      request.user = {
        sub: String(delegation.owner_id),
        guildId: delegation.owner_guild_id,
        role: 'MEMBER',
        username: delegation.owner_username,
        nickname: delegation.owner_nickname,
        principalType: 'MEMBER_DEPUTY',
        principalId: delegation.deputy_id,
        delegatedUserId: delegation.owner_id,
        actorUsername: delegation.deputy_username,
        actorNickname: delegation.deputy_nickname,
        activeCharacterKey: activeCharacter.characterKey,
        activeCharacterOwnerUserId: activeCharacter.ownerUserId,
        activeCharacterType: activeCharacter.characterType,
        activeCharacterName: activeCharacter.characterName,
      };
      return;
    }

    const currentUser = repository.findUserById(principalId);
    if (!currentUser || !currentUser.isActive) {
      throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    }
    request.user = {
      sub: String(currentUser.id),
      guildId: currentUser.guildId,
      role: currentUser.role,
      username: currentUser.username,
      nickname: currentUser.nickname,
      principalType: 'USER',
      principalId: currentUser.id,
      actorUsername: currentUser.username,
      actorNickname: currentUser.nickname,
    };
  };

  app.decorate('authenticate', async (request: FastifyRequest) => {
    try {
      await request.jwtVerify<AuthenticatedUser>();
    } catch {
      if (config.jwtPreviousSecret) {
        try {
          const token = app.jwt.lookupToken(request);
          request.user = app.jwt.verify<AuthenticatedUser>(token, {
            key: config.jwtPreviousSecret,
          });
        } catch {
          // The same generic authentication error is returned for both keys.
          throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
        }
      } else {
        throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
      }
    }
    normalizeUser(request);
  });
};
