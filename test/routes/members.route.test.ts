import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app';
import { createTestConfig } from '../helpers/test-config';

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

const baseProfile = {
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

const createMasterSession = async (app: Awaited<ReturnType<typeof buildApp>>) => {
  const registerResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { mode: 'CREATE_GUILD', guild_name: '프로필 테스트 길드', ...baseProfile },
  });
  const registration = registerResponse.json() as {
    data: { userId: number; guildId: number };
  };

  const loginResponse = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username: baseProfile.username, password: baseProfile.password },
  });
  const login = loginResponse.json() as { token: string };

  return {
    token: login.token,
    userId: registration.data.userId,
    guildId: registration.data.guildId,
  };
};

const legacyUpdate = {
  nickname: '프레이야2',
  occupation: '소서리스',
  main_class: '다크 위저드',
  combat_power: 160000,
  equipment: {
    무기: { val: '발뭉 8강', color: 'mythic' },
  },
  skills: {
    active: { '영웅 1': '9강' },
    passive: { '전설 1': '1강' },
  },
  max_crit_rate: 52.3,
  max_crit_resist: 41.2,
  status_effect_acc: 18.0,
  alternate_characters: [{ character_name: '프레이야부캐', main_class: '세인트' }],
  password: 'new-password',
};

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('member profile routes', () => {
  it('returns the current profile on both v1 and Flutter legacy contracts', async () => {
    const app = await createApp();
    const session = await createMasterSession(app);
    const headers = { authorization: `Bearer ${session.token}` };

    const legacyResponse = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers,
    });
    expect(legacyResponse.statusCode).toBe(200);
    expect(legacyResponse.json()).toMatchObject({
      id: session.userId,
      username: 'freya',
      role: 'MASTER',
      nickname: '프레이야',
      occupation: '소서리스',
      main_class: '아크 메이지',
      combat_power: 150000,
      max_crit_rate: 0,
      max_crit_resist: 0,
      status_effect_acc: 0,
      alternate_characters: [],
    });

    const v1Response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers,
    });
    expect(v1Response.statusCode).toBe(200);
    expect(v1Response.json()).toMatchObject({
      data: {
        id: session.userId,
        username: 'freya',
        mainClass: '아크 메이지',
        combatPower: 150000,
        alternateCharacters: [],
      },
    });
  });

  it('updates the profile atomically, stores alternate character data, and changes the password', async () => {
    const app = await createApp();
    const session = await createMasterSession(app);
    const headers = { authorization: `Bearer ${session.token}` };

    const updateResponse = await app.inject({
      method: 'PUT',
      url: '/api/users/me',
      headers,
      payload: legacyUpdate,
    });
    expect(updateResponse.statusCode).toBe(204);

    const profileResponse = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers,
    });
    expect(profileResponse.statusCode).toBe(200);
    expect(profileResponse.json()).toMatchObject({
      nickname: '프레이야2',
      main_class: '다크 위저드',
      combat_power: 160000,
      max_crit_rate: 52.3,
      max_crit_resist: 41.2,
      status_effect_acc: 18,
      alternate_characters: [{ character_name: '프레이야부캐', main_class: '세인트' }],
    });

    const oldPasswordLogin = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'freya', password: 'strong-password' },
    });
    expect(oldPasswordLogin.statusCode).toBe(401);

    const newPasswordLogin = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'freya', password: 'new-password' },
    });
    expect(newPasswordLogin.statusCode).toBe(200);
  });

  it('prevents a member from changing combat power when the guild setting is locked', async () => {
    const app = await createApp();
    const owner = await createMasterSession(app);
    app.db
      .prepare('INSERT INTO invites (guild_id, code, role) VALUES (?, ?, ?)')
      .run(owner.guildId, 'MEMBER-1', 'MEMBER');

    const joinResponse = await app.inject({
      method: 'POST',
      url: '/api/users/register',
      payload: {
        mode: 'JOIN_GUILD',
        code: 'MEMBER-1',
        ...baseProfile,
        username: 'thor',
        nickname: '토르',
      },
    });
    expect(joinResponse.statusCode).toBe(201);

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'thor', password: baseProfile.password },
    });
    const memberToken = (loginResponse.json() as { token: string }).token;
    app.db
      .prepare('UPDATE guild_settings SET allow_member_combat_power_edit = 0 WHERE guild_id = ?')
      .run(owner.guildId);

    const updateResponse = await app.inject({
      method: 'PUT',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { ...legacyUpdate, combat_power: 160001, password: undefined },
    });

    expect(updateResponse.statusCode).toBe(403);
    expect(updateResponse.json()).toMatchObject({
      code: 'COMBAT_POWER_EDIT_FORBIDDEN',
    });
  });

  it('requires authentication and validates class combinations', async () => {
    const app = await createApp();
    const unauthenticated = await app.inject({
      method: 'GET',
      url: '/api/users/me',
    });
    expect(unauthenticated.statusCode).toBe(401);

    const session = await createMasterSession(app);
    const invalidUpdate = await app.inject({
      method: 'PUT',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${session.token}` },
      payload: {
        nickname: '프레이야',
        occupation: '워리어',
        mainClass: '아크 메이지',
        combatPower: 150000,
        equipment: {},
        skills: { active: {}, passive: {} },
        maxCritRate: 0,
        maxCritResist: 0,
        statusEffectAcc: 0,
        alternateCharacters: [],
      },
    });
    expect(invalidUpdate.statusCode).toBe(422);
    expect(invalidUpdate.json()).toMatchObject({
      error: { code: 'INVALID_CLASS_COMBINATION' },
    });
  });
});
