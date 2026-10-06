import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app';
import { createTestConfig } from '../helpers/test-config';

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

const profileFor = (username: string, nickname: string, combatPower = 120000) => ({
  username,
  password: 'strong-password',
  nickname,
  occupation: '프리스트',
  main_class: '세인트',
  combat_power: combatPower,
  equipment: { 무기: { val: '테스트 무기', color: 'hero' } },
  skills: { active: { '영웅 1': '1강' }, passive: { '전설 1': 'X' } },
});

const createApp = async () => {
  const app = await buildApp(createTestConfig(), { logger: false });
  openApps.push(app);
  return app;
};

const login = async (app: Awaited<ReturnType<typeof buildApp>>, username: string) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username, password: 'strong-password' },
  });
  return (response.json() as { token: string }).token;
};

const createGuild = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  username: string,
  nickname: string,
  combatPower: number,
) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      mode: 'CREATE_GUILD',
      guild_name: `${nickname} 길드`,
      ...profileFor(username, nickname, combatPower),
    },
  });
  expect(response.statusCode).toBe(201);
  const data = (response.json() as { data: { userId: number; guildId: number } }).data;
  return { ...data, token: await login(app, username) };
};

const joinGuild = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  guildId: number,
  username: string,
  nickname: string,
  combatPower: number,
) => {
  const code = `MEMBER-${username}`.toUpperCase();
  app.db
    .prepare(
      `
        INSERT INTO invites (guild_id, code, role)
        VALUES (?, ?, 'MEMBER')
        ON CONFLICT(guild_id, role) DO UPDATE SET code = excluded.code
      `,
    )
    .run(guildId, code);
  const response = await app.inject({
    method: 'POST',
    url: '/api/users/register',
    payload: { mode: 'JOIN_GUILD', code, ...profileFor(username, nickname, combatPower) },
  });
  expect(response.statusCode).toBe(201);
  const data = response.json() as { userId: number };
  return { ...data, token: await login(app, username) };
};

const createDeputySession = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  masterToken: string,
  characterOwnerId: number,
) => {
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/deputy-accounts',
    headers: { authorization: `Bearer ${masterToken}` },
    payload: { username: 'guild-deputy', password: 'deputy-password', nickname: '길드 부주' },
  });
  expect(created.statusCode).toBe(201);

  const loginResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/deputy-auth/login',
    payload: { username: 'guild-deputy', password: 'deputy-password' },
  });
  expect(loginResponse.statusCode).toBe(200);
  const token = (loginResponse.json() as { data: { token: string } }).data.token;

  const selected = await app.inject({
    method: 'PUT',
    url: '/api/v1/deputy/active-character',
    headers: { authorization: `Bearer ${token}` },
    payload: { characterKey: `MAIN:${characterOwnerId}` },
  });
  expect(selected.statusCode).toBe(200);
  return token;
};

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('deputy feature permissions', () => {
  it('allows the complete schedule and read-only content overview without exposing full member profiles', async () => {
    const app = await createApp();
    const owner = await createGuild(app, 'deputy-owner', '길드장', 175000);
    const member = await joinGuild(app, owner.guildId, 'deputy-member', '길드원', 145000);
    const groupResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/content-groups',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { name: '1군' },
    });
    const groupId = (groupResponse.json() as { data: { id: number } }).data.id;
    const assignMember = await app.inject({
      method: 'PUT',
      url: `/api/v1/content-groups/${groupId}/members`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { userIds: [member.userId] },
    });
    expect(assignMember.statusCode).toBe(204);

    const deputyToken = await createDeputySession(app, owner.token, owner.userId);
    const headers = { authorization: `Bearer ${deputyToken}` };
    const readablePaths = [
      '/api/v1/schedules',
      '/api/v1/bosses',
      '/api/v1/participation-targets',
      '/api/v1/participants',
      '/api/v1/participation-states',
      `/api/v1/boss-votes?characterKey=MAIN:${owner.userId}`,
      '/api/v1/support-requests',
      '/api/v1/content-groups',
      '/api/v1/content-groups/roster',
    ];

    for (const url of readablePaths) {
      const response = await app.inject({ method: 'GET', url, headers });
      expect(response.statusCode, `GET ${url}`).toBe(200);
    }

    const rosterResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/content-groups/roster',
      headers,
    });
    const roster = (
      rosterResponse.json() as {
        data: Array<Record<string, unknown>>;
      }
    ).data;
    expect(roster).toEqual([
      {
        id: owner.userId,
        nickname: '길드장',
        occupation: '프리스트',
        mainClass: '세인트',
        combatPower: 175000,
      },
      {
        id: member.userId,
        nickname: '길드원',
        occupation: '프리스트',
        mainClass: '세인트',
        combatPower: 145000,
      },
    ]);

    const fullProfiles = await app.inject({
      method: 'GET',
      url: '/api/v1/members',
      headers,
    });
    expect(fullProfiles.statusCode).toBe(403);
    expect(fullProfiles.json()).toMatchObject({
      error: { code: 'DEPUTY_FEATURE_FORBIDDEN' },
    });
  }, 15_000);

  it('does not grant schedule, boss, or content-group management through the read routes', async () => {
    const app = await createApp();
    const owner = await createGuild(app, 'deputy-admin-owner', '길드장', 175000);
    const deputyToken = await createDeputySession(app, owner.token, owner.userId);
    const headers = { authorization: `Bearer ${deputyToken}` };

    const contentMutation = await app.inject({
      method: 'POST',
      url: '/api/v1/content-groups',
      headers,
      payload: { name: '권한 없는 그룹' },
    });
    expect(contentMutation.statusCode).toBe(403);

    const bossMutation = await app.inject({
      method: 'DELETE',
      url: '/api/v1/bosses/1',
      headers,
    });
    expect(bossMutation.statusCode).toBe(403);

    const scheduleMutation = await app.inject({
      method: 'DELETE',
      url: '/api/v1/schedules/1',
      headers,
    });
    expect(scheduleMutation.statusCode).toBe(403);
  }, 15_000);
});
