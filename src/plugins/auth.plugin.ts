import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AppConfig } from '../config/env';
import { AppError } from '../shared/errors/app-error';

export interface AuthenticatedUser {
  sub: string;
  guildId: number;
  role: 'MASTER' | 'ADMIN' | 'MEMBER';
  username: string;
  nickname: string;
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

  app.decorate('authenticate', async (request: FastifyRequest) => {
    try {
      await request.jwtVerify<AuthenticatedUser>();
    } catch {
      throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    }
  });
};
