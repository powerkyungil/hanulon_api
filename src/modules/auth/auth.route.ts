import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { API_PREFIX } from '../../config/constants';
import { success } from '../../shared/http/response';
import { AuthRepository } from './auth.repository';
import {
  legacyRegistrationResponseSchema,
  legacySessionResponseSchema,
  loginBodySchema,
  registerBodySchema,
  v1RegistrationResponseSchema,
  v1SessionResponseSchema,
  type LoginBody,
  type RegisterBody,
} from './auth.schema';
import { AuthService } from './auth.service';
import type { AuthSession, AuthUser } from './auth.types';

type ResponseStyle = 'v1' | 'legacy';

interface AuthRouteConfig {
  responseStyle: ResponseStyle;
}

type LoginRequest = FastifyRequest<{ Body: LoginBody }>;
type RegisterRequest = FastifyRequest<{ Body: RegisterBody }>;

const routeConfig = (responseStyle: ResponseStyle): AuthRouteConfig => ({ responseStyle });

const issueSession = (app: FastifyInstance, user: AuthUser): AuthSession => {
  const token = app.jwt.sign({
    sub: String(user.id),
    guildId: user.guildId,
    role: user.role,
    username: user.username,
    nickname: user.nickname,
  });

  return {
    token,
    userId: user.id,
    username: user.username,
    nickname: user.nickname,
    role: user.role,
  };
};

const sendByStyle = <T>(reply: FastifyReply, responseStyle: ResponseStyle, data: T): FastifyReply =>
  reply.send(responseStyle === 'v1' ? success(data) : data);

export const registerAuthRoutes = async (app: FastifyInstance): Promise<void> => {
  const service = new AuthService(new AuthRepository(app.db));

  const registerLoginRoute = (url: string, responseStyle: ResponseStyle): void => {
    app.post(
      url,
      {
        config: routeConfig(responseStyle),
        schema: {
          tags: ['auth'],
          body: loginBodySchema,
          response: {
            200: responseStyle === 'v1' ? v1SessionResponseSchema : legacySessionResponseSchema,
          },
        },
      },
      async (request: LoginRequest, reply) => {
        const user = await service.login(request.body.username, request.body.password);
        return sendByStyle(reply, responseStyle, issueSession(app, user));
      },
    );
  };

  const registerRegistrationRoute = (url: string, responseStyle: ResponseStyle): void => {
    app.post(
      url,
      {
        config: routeConfig(responseStyle),
        schema: {
          tags: ['auth'],
          body: registerBodySchema,
          response: {
            201:
              responseStyle === 'v1'
                ? v1RegistrationResponseSchema
                : legacyRegistrationResponseSchema,
          },
        },
      },
      async (request: RegisterRequest, reply) => {
        const result = await service.register(request.body);
        const response = responseStyle === 'v1' ? success(result) : result;
        return reply.code(201).send(response);
      },
    );
  };

  registerLoginRoute(`${API_PREFIX}/auth/login`, 'v1');
  registerRegistrationRoute(`${API_PREFIX}/auth/register`, 'v1');

  // Flutter's current ApiPaths use these legacy paths. Keep them as a thin compatibility layer.
  registerLoginRoute('/api/login', 'legacy');
  registerRegistrationRoute('/api/users/register', 'legacy');
};
