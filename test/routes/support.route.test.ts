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
  equipment: {},
  skills: { active: {}, passive: {} },
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
  guildName: string,
  username: string,
) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      mode: 'CREATE_GUILD',
      guild_name: guildName,
      ...profileFor(username, `${username} 길드장`),
    },
  });
  const data = (response.json() as { data: { userId: number; guildId: number } }).data;
  return { ...data, token: await login(app, username) };
};

const joinGuild = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  guildId: number,
  role: 'MEMBER' | 'ADMIN',
  username: string,
) => {
  const code = `${role}-${username}`.toUpperCase();
  app.db
    .prepare(
      `
        INSERT INTO invites (guild_id, code, role)
        VALUES (?, ?, ?)
        ON CONFLICT(guild_id, role) DO UPDATE SET code = excluded.code
      `,
    )
    .run(guildId, code, role);
  const response = await app.inject({
    method: 'POST',
    url: '/api/users/register',
    payload: { mode: 'JOIN_GUILD', code, ...profileFor(username, username) },
  });
  expect(response.statusCode).toBe(201);
  const data = response.json() as { userId: number };
  return { ...data, token: await login(app, username) };
};

const createSupportRequest = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  requestedTime = '2026-08-12 20:00~21:00',
) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/support-requests',
    headers: { authorization: `Bearer ${token}` },
    payload: { requestedTime, memo: '장비 세팅 도움' },
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { id: number }).id;
};

const apply = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  requestId: number,
) => {
  const response = await app.inject({
    method: 'POST',
    url: `/api/support-requests/${requestId}/applications`,
    headers: { authorization: `Bearer ${token}` },
    payload: { memo: '가능합니다.' },
  });
  return response;
};

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('support request routes', () => {
  it('creates and lists guild-scoped requests in legacy and v1 response formats', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '손지원 길드', 'supportowner');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'supportmember');
    const otherOwner = await createGuild(app, '다른 손지원 길드', 'othersupportowner');

    const requestId = await createSupportRequest(app, member.token);

    const legacyList = await app.inject({
      method: 'GET',
      url: '/api/support-requests',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(legacyList.statusCode).toBe(200);
    expect(legacyList.json()).toMatchObject([
      {
        id: requestId,
        requesterId: member.userId,
        requestedTime: '2026-08-12 20:00~21:00',
        status: 'OPEN',
        selectedApplicationId: null,
        nickname: 'supportmember',
        mainClass: '세인트',
        combatPower: 120000,
        applications: [],
      },
    ]);
    expect((legacyList.json() as Array<{ createdAt: string }>)[0]?.createdAt).toMatch(/Z$/);
    expect(JSON.stringify(legacyList.json())).not.toContain('password');
    expect(JSON.stringify(legacyList.json())).not.toContain('username');

    const v1List = await app.inject({
      method: 'GET',
      url: '/api/v1/support-requests',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(v1List.statusCode).toBe(200);
    expect(v1List.json()).toMatchObject({
      data: [{ id: requestId, createdAt: expect.any(Number), updatedAt: expect.any(Number) }],
    });

    const isolatedList = await app.inject({
      method: 'GET',
      url: '/api/support-requests',
      headers: { authorization: `Bearer ${otherOwner.token}` },
    });
    expect(isolatedList.json()).toEqual([]);

    const crossGuildMutation = await app.inject({
      method: 'DELETE',
      url: `/api/support-requests/${requestId}`,
      headers: { authorization: `Bearer ${otherOwner.token}` },
    });
    expect(crossGuildMutation.statusCode).toBe(404);
  });

  it('rejects invalid, self, duplicate, and closed-request applications', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '신청 규칙 길드', 'applicationowner');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'applicationmember');
    const another = await joinGuild(app, owner.guildId, 'MEMBER', 'anotherapplicant');
    const requestId = await createSupportRequest(app, owner.token);

    const selfApplication = await apply(app, owner.token, requestId);
    expect(selfApplication.statusCode).toBe(422);
    expect(selfApplication.json()).toMatchObject({
      code: 'SUPPORT_SELF_APPLICATION_FORBIDDEN',
    });

    const firstApplication = await apply(app, member.token, requestId);
    expect(firstApplication.statusCode).toBe(200);
    expect(firstApplication.json()).toMatchObject({ success: true, id: expect.any(Number) });

    const duplicate = await apply(app, member.token, requestId);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'SUPPORT_ALREADY_APPLIED' });

    const close = await app.inject({
      method: 'PUT',
      url: `/api/support-requests/${requestId}/status`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { status: 'DONE' },
    });
    expect(close.statusCode).toBe(200);

    const closedApplication = await apply(app, another.token, requestId);
    expect(closedApplication.statusCode).toBe(409);
    expect(closedApplication.json()).toMatchObject({ code: 'SUPPORT_REQUEST_NOT_OPEN' });
  });

  it('selects and switches applicants, then reopens when the selected applicant cancels', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '매칭 길드', 'matchingowner');
    const first = await joinGuild(app, owner.guildId, 'MEMBER', 'firstapplicant');
    const second = await joinGuild(app, owner.guildId, 'MEMBER', 'secondapplicant');
    const requestId = await createSupportRequest(app, owner.token);
    const firstApplicationId = (await apply(app, first.token, requestId)).json().id as number;
    const secondApplicationId = (await apply(app, second.token, requestId)).json().id as number;

    const forbiddenSelection = await app.inject({
      method: 'POST',
      url: `/api/support-requests/${requestId}/select/${secondApplicationId}`,
      headers: { authorization: `Bearer ${first.token}` },
    });
    expect(forbiddenSelection.statusCode).toBe(403);

    const selectFirst = await app.inject({
      method: 'POST',
      url: `/api/support-requests/${requestId}/select/${firstApplicationId}`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(selectFirst.statusCode).toBe(200);

    const switchSelection = await app.inject({
      method: 'POST',
      url: `/api/v1/support-requests/${requestId}/select/${secondApplicationId}`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(switchSelection.statusCode).toBe(204);

    const matched = await app.inject({
      method: 'GET',
      url: '/api/support-requests',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(matched.json()).toMatchObject([
      {
        status: 'MATCHED',
        selectedApplicationId: secondApplicationId,
        applications: [
          { id: secondApplicationId, status: 'SELECTED' },
          { id: firstApplicationId, status: 'APPLIED' },
        ],
      },
    ]);

    const selectedCancellation = await app.inject({
      method: 'DELETE',
      url: `/api/support-requests/${requestId}/applications/${secondApplicationId}`,
      headers: { authorization: `Bearer ${second.token}` },
    });
    expect(selectedCancellation.statusCode).toBe(200);

    const reopened = await app.inject({
      method: 'GET',
      url: '/api/support-requests',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(reopened.json()).toMatchObject([
      {
        status: 'OPEN',
        selectedApplicationId: null,
        applications: [{ id: firstApplicationId, status: 'APPLIED' }],
      },
    ]);
  });

  it('enforces request ownership, staff management, and explicit status transitions', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '관리 권한 길드', 'manageowner');
    const admin = await joinGuild(app, owner.guildId, 'ADMIN', 'supportadmin');
    const requester = await joinGuild(app, owner.guildId, 'MEMBER', 'supportrequester');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'supportoutsider');
    const requestId = await createSupportRequest(app, requester.token, '2026-08-13 종일');

    const denied = await app.inject({
      method: 'PUT',
      url: `/api/support-requests/${requestId}/status`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { status: 'CANCELED' },
    });
    expect(denied.statusCode).toBe(403);

    const directMatched = await app.inject({
      method: 'PUT',
      url: `/api/v1/support-requests/${requestId}/status`,
      headers: { authorization: `Bearer ${requester.token}` },
      payload: { status: 'MATCHED' },
    });
    expect(directMatched.statusCode).toBe(409);
    expect(directMatched.json()).toMatchObject({
      error: { code: 'SUPPORT_STATUS_TRANSITION_INVALID' },
    });

    const staffClose = await app.inject({
      method: 'PUT',
      url: `/api/v1/support-requests/${requestId}/status`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { status: 'CANCELED' },
    });
    expect(staffClose.statusCode).toBe(204);

    const reopen = await app.inject({
      method: 'PUT',
      url: `/api/support-requests/${requestId}/status`,
      headers: { authorization: `Bearer ${requester.token}` },
      payload: { status: 'OPEN' },
    });
    expect(reopen.statusCode).toBe(200);

    const deleteDenied = await app.inject({
      method: 'DELETE',
      url: `/api/support-requests/${requestId}`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(deleteDenied.statusCode).toBe(403);

    const staffDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/support-requests/${requestId}`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(staffDelete.statusCode).toBe(204);

    const auditActions = app.db
      .prepare('SELECT action FROM support_audit_logs WHERE guild_id = ? ORDER BY id ASC')
      .all(owner.guildId) as Array<{ action: string }>;
    expect(auditActions.map((audit) => audit.action)).toEqual([
      'REQUEST_CREATED',
      'REQUEST_STATUS_CHANGED',
      'REQUEST_STATUS_CHANGED',
      'REQUEST_DELETED',
    ]);
  });
});
