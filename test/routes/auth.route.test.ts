import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app';
import { createTestConfig } from '../helpers/test-config';

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

const profilePayload = {
  username: 'freya',
  password: 'strong-password',
  nickname: '프레이야',
  occupation: '소서리스',
  main_class: '아크 메이지',
  combat_power: 150000,
  equipment: {
    무기: { val: '발뭉 7강', color: 'legend' },
  },
  skills: {
    active: { '영웅 1': '8강' },
    passive: { '전설 1': 'X' },
  },
};

const createApp = async () => {
  const app = await buildApp(createTestConfig(), { logger: false });
  openApps.push(app);
  return app;
};

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('auth routes', () => {
  it('creates a guild master and returns a v1 login session with tenant claims', async () => {
    const app = await createApp();

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        mode: 'CREATE_GUILD',
        guild_name: '발할라 테스트 길드',
        ...profilePayload,
      },
    });

    expect(registerResponse.statusCode).toBe(201);
    const registrationBody = registerResponse.json() as {
      data: { userId: number; guildId: number; role: string };
    };
    expect(registrationBody.data.role).toBe('MASTER');

    const storedUser = app.db
      .prepare('SELECT guild_id, role, password_hash FROM users WHERE id = ?')
      .get(registrationBody.data.userId) as {
      guild_id: number;
      role: string;
      password_hash: string;
    };
    expect(storedUser.guild_id).toBe(registrationBody.data.guildId);
    expect(storedUser.role).toBe('MASTER');
    expect(storedUser.password_hash).not.toBe(profilePayload.password);

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: profilePayload.username,
        password: profilePayload.password,
      },
    });

    expect(loginResponse.statusCode).toBe(200);
    const loginBody = loginResponse.json() as {
      data: {
        token: string;
        userId: number;
        username: string;
        nickname: string;
        role: string;
      };
    };
    expect(loginBody.data).toMatchObject({
      userId: registrationBody.data.userId,
      username: profilePayload.username,
      nickname: profilePayload.nickname,
      role: 'MASTER',
    });
    expect(loginBody.data.token).toBeTruthy();

    const claims = app.jwt.decode(loginBody.data.token) as {
      sub: string;
      guildId: number;
      role: string;
    };
    expect(claims).toMatchObject({
      sub: String(registrationBody.data.userId),
      guildId: registrationBody.data.guildId,
      role: 'MASTER',
    });
  });

  it('accepts the current Flutter legacy paths and returns the raw response shape', async () => {
    const app = await createApp();

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/api/users/register',
      payload: {
        mode: 'CREATE_GUILD',
        guild_name: '레거시 테스트 길드',
        ...profilePayload,
      },
    });
    expect(registerResponse.statusCode).toBe(201);

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: {
        username: profilePayload.username,
        password: profilePayload.password,
      },
    });

    expect(loginResponse.statusCode).toBe(200);
    expect(loginResponse.json()).toMatchObject({
      username: profilePayload.username,
      nickname: profilePayload.nickname,
      role: 'MASTER',
    });
    expect(loginResponse.json()).not.toHaveProperty('data');
  });

  it('joins an existing guild with the role attached to the invite code', async () => {
    const app = await createApp();

    const ownerResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        mode: 'CREATE_GUILD',
        guild_name: '초대 테스트 길드',
        ...profilePayload,
      },
    });
    const guildId = (ownerResponse.json() as { data: { guildId: number } }).data.guildId;
    app.db
      .prepare('INSERT INTO invites (guild_id, code, role) VALUES (?, ?, ?)')
      .run(guildId, 'JOIN-MEMBER', 'MEMBER');

    const joinResponse = await app.inject({
      method: 'POST',
      url: '/api/users/register',
      payload: {
        mode: 'JOIN_GUILD',
        code: 'join-member',
        ...profilePayload,
        username: 'thor',
        nickname: '토르',
      },
    });

    expect(joinResponse.statusCode).toBe(201);
    const joined = joinResponse.json() as {
      userId: number;
      guildId: number;
      role: string;
    };
    expect(joined).toMatchObject({ guildId, role: 'MEMBER' });

    const storedJoinedUser = app.db
      .prepare('SELECT guild_id, role FROM users WHERE id = ?')
      .get(joined.userId) as { guild_id: number; role: string };
    expect(storedJoinedUser).toEqual({ guild_id: guildId, role: 'MEMBER' });
  });

  it('rejects invalid credentials and duplicate accounts without exposing secrets', async () => {
    const app = await createApp();

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        mode: 'CREATE_GUILD',
        guild_name: '중복 테스트 길드',
        ...profilePayload,
      },
    });

    const invalidLogin = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: profilePayload.username, password: 'wrong-password' },
    });
    expect(invalidLogin.statusCode).toBe(401);
    expect(invalidLogin.json()).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: '아이디 또는 비밀번호가 올바르지 않습니다.',
    });
    expect(JSON.stringify(invalidLogin.json())).not.toContain('wrong-password');

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        mode: 'CREATE_GUILD',
        guild_name: '다른 길드',
        ...profilePayload,
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({
      error: { code: 'USERNAME_EXISTS' },
    });
  });
});
