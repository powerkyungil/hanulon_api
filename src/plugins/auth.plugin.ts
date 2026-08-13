import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AppConfig } from '../config/env';
import { AuthRepository } from '../modules/auth/auth.repository';
import { AppError } from '../shared/errors/app-error';

export interface AuthenticatedUser {
  sub: string;
  guildId: number;
  role: 'MASTER' | 'ADMIN' | 'MEMBER';
  username: string;
  nickname: string;
}

interface LegacyAuthenticatedUser extends Partial<AuthenticatedUser> {
  id?: number;
}

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
    const userId = Number(payload.sub ?? payload.id);
    if (!Number.isSafeInteger(userId) || userId < 1) {
      throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    }
    const currentUser = repository.findUserById(userId);
    if (!currentUser || !currentUser.isActive) {
      throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    }
    request.user = {
      sub: String(currentUser.id),
      guildId: currentUser.guildId,
      role: currentUser.role,
      username: currentUser.username,
      nickname: currentUser.nickname,
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
