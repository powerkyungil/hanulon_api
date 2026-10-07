import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app';
import { createTestConfig } from '../helpers/test-config';

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

const profileFor = (username: string, nickname: string) => ({
  username,
  password: 'strong-password',
  nickname,
  occupation: '프리스트',
  main_class: '세인트',
  combat_power: 120000,
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
    url: '/api/v1/auth/login',
    payload: { username, password: 'strong-password' },
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { data: { token: string } }).data.token;
};

const createGuild = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  username: string,
  nickname: string,
) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      mode: 'CREATE_GUILD',
      guild_name: `${nickname} 길드`,
      ...profileFor(username, nickname),
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
    url: '/api/v1/auth/register',
    payload: { mode: 'JOIN_GUILD', code, ...profileFor(username, nickname) },
  });
  expect(response.statusCode).toBe(201);
  const data = (response.json() as { data: { userId: number } }).data;
  return { ...data, token: await login(app, username) };
};

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('member delegation routes', () => {
  it('lets one MEMBER grant another MEMBER a restricted acting session', async () => {
    const app = await createApp();
    const master = await createGuild(app, 'delegation-master', '길드장');
    const owner = await joinGuild(app, master.guildId, 'delegation-owner', '대상 회원');
    const deputy = await joinGuild(app, master.guildId, 'delegation-deputy', '부주 회원');

    const grant = await app.inject({
      method: 'POST',
      url: '/api/v1/member-delegations',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { deputyUserId: deputy.userId },
    });
    expect(grant.statusCode).toBe(201);
    expect(grant.json()).toMatchObject({
      data: {
        ownerUserId: owner.userId,
        deputyUserId: deputy.userId,
        isActive: true,
      },
    });

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/member-delegations',
      headers: { authorization: `Bearer ${deputy.token}` },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      data: {
        received: [
          expect.objectContaining({
            ownerUserId: owner.userId,
            deputyUserId: deputy.userId,
            isActive: true,
          }),
        ],
      },
    });

    const session = await app.inject({
      method: 'POST',
      url: '/api/v1/member-delegations/session',
      headers: { authorization: `Bearer ${deputy.token}` },
      payload: {
        ownerUserId: owner.userId,
        characterKey: `MAIN:${owner.userId}`,
      },
    });
    expect(session.statusCode).toBe(200);
    const delegatedToken = (session.json() as { data: { token: string } }).data.token;

    const schedules = await app.inject({
      method: 'GET',
      url: '/api/v1/schedules',
      headers: { authorization: `Bearer ${delegatedToken}` },
    });
    expect(schedules.statusCode).toBe(200);

    const memberList = await app.inject({
      method: 'GET',
      url: '/api/v1/members',
      headers: { authorization: `Bearer ${delegatedToken}` },
    });
    expect(memberList.statusCode).toBe(403);
    expect(memberList.json()).toMatchObject({ error: { code: 'DEPUTY_FEATURE_FORBIDDEN' } });

    const supportRequest = await app.inject({
      method: 'POST',
      url: '/api/v1/support-requests',
      headers: { authorization: `Bearer ${delegatedToken}` },
      payload: { requestedTime: '오늘 21:00', memo: '대리 요청' },
    });
    expect(supportRequest.statusCode).toBe(201);
    const requestId = (supportRequest.json() as { data: { id: number } }).data.id;

    const supportRow = app.db
      .prepare(
        `
          SELECT requester_id, actor_user_id
          FROM support_requests
          WHERE id = ?
        `,
      )
      .get(requestId) as { requester_id: number; actor_user_id: number };
    expect(supportRow).toEqual({ requester_id: owner.userId, actor_user_id: deputy.userId });

    const auditRow = app.db
      .prepare(
        `
          SELECT actor_user_id, action
          FROM support_audit_logs
          WHERE request_id = ?
          ORDER BY id DESC
          LIMIT 1
        `,
      )
      .get(requestId) as { actor_user_id: number; action: string };
    expect(auditRow).toEqual({ actor_user_id: deputy.userId, action: 'REQUEST_CREATED' });

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/v1/member-delegations/${deputy.userId}`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(revoke.statusCode).toBe(204);

    const revokedSession = await app.inject({
      method: 'GET',
      url: '/api/v1/schedules',
      headers: { authorization: `Bearer ${delegatedToken}` },
    });
    expect(revokedSession.statusCode).toBe(401);
  });

  it('rejects non-MEMBER users and prevents cross-member character sessions', async () => {
    const app = await createApp();
    const master = await createGuild(app, 'delegation-policy-master', '길드장');
    const owner = await joinGuild(app, master.guildId, 'delegation-policy-owner', '대상 회원');
    const deputy = await joinGuild(app, master.guildId, 'delegation-policy-deputy', '부주 회원');

    const masterGrant = await app.inject({
      method: 'POST',
      url: '/api/v1/member-delegations',
      headers: { authorization: `Bearer ${master.token}` },
      payload: { deputyUserId: deputy.userId },
    });
    expect(masterGrant.statusCode).toBe(403);
    expect(masterGrant.json()).toMatchObject({
      error: { code: 'MEMBER_DELEGATION_MEMBER_ONLY' },
    });

    const crossMemberSession = await app.inject({
      method: 'POST',
      url: '/api/v1/member-delegations/session',
      headers: { authorization: `Bearer ${deputy.token}` },
      payload: {
        ownerUserId: owner.userId,
        characterKey: `MAIN:${master.userId}`,
      },
    });
    expect(crossMemberSession.statusCode).toBe(403);
    expect(crossMemberSession.json()).toMatchObject({
      error: { code: 'MEMBER_DELEGATION_FORBIDDEN' },
    });
  });
});
