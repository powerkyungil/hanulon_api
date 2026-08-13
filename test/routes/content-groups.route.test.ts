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

const createGroup = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  name: string,
) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/groups',
    headers: { authorization: `Bearer ${token}` },
    payload: { name },
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { id: number }).id;
};

const saveMembers = (
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  groupId: number,
  userIds: number[],
) =>
  app.inject({
    method: 'POST',
    url: `/api/groups/${groupId}/members`,
    headers: { authorization: `Bearer ${token}` },
    payload: { userIds },
  });

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('content group routes', () => {
  it('allows all active members to read but only staff to manage guild-scoped groups', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '콘텐츠 길드', 'contentowner');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'contentmember');
    const admin = await joinGuild(app, owner.guildId, 'ADMIN', 'contentadmin');
    const otherOwner = await createGuild(app, '다른 콘텐츠 길드', 'othercontentowner');

    const read = await app.inject({
      method: 'GET',
      url: '/api/groups',
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual([]);

    const denied = await app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: { authorization: `Bearer ${member.token}` },
      payload: { name: '권한 없는 그룹' },
    });
    expect(denied.statusCode).toBe(403);

    const groupId = await createGroup(app, admin.token, '1군 레이드');
    const v1Read = await app.inject({
      method: 'GET',
      url: '/api/v1/content-groups',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(v1Read.json()).toEqual({
      data: [{ id: groupId, name: '1군 레이드', memberIds: [] }],
    });

    const isolated = await app.inject({
      method: 'GET',
      url: '/api/groups',
      headers: { authorization: `Bearer ${otherOwner.token}` },
    });
    expect(isolated.json()).toEqual([]);

    const crossGuildRename = await app.inject({
      method: 'PUT',
      url: `/api/groups/${groupId}`,
      headers: { authorization: `Bearer ${otherOwner.token}` },
      payload: { name: '다른 길드 변경' },
    });
    expect(crossGuildRename.statusCode).toBe(404);
  }, 15_000);

  it('creates, renames, and deletes a group while returning assigned members to unassigned', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '그룹 관리 길드', 'groupowner');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'groupmember');
    const firstGroupId = await createGroup(app, owner.token, '발할라');
    const secondGroupId = await createGroup(app, owner.token, '아스가르드');

    const assigned = await saveMembers(app, owner.token, firstGroupId, [member.userId]);
    expect(assigned.statusCode).toBe(204);

    const renamed = await app.inject({
      method: 'PUT',
      url: `/api/v1/content-groups/${firstGroupId}`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { name: '발할라 1군' },
    });
    expect(renamed.statusCode).toBe(204);

    const duplicateName = await app.inject({
      method: 'PUT',
      url: `/api/groups/${firstGroupId}`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { name: '아스가르드' },
    });
    expect(duplicateName.statusCode).toBe(409);
    expect(duplicateName.json()).toMatchObject({ code: 'CONTENT_GROUP_NAME_EXISTS' });

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/groups/${firstGroupId}`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(deleted.statusCode).toBe(204);

    const reassigned = await app.inject({
      method: 'PUT',
      url: `/api/v1/content-groups/${secondGroupId}/members`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { userIds: [member.userId] },
    });
    expect(reassigned.statusCode).toBe(204);

    const groups = await app.inject({
      method: 'GET',
      url: '/api/groups',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(groups.json()).toEqual([
      { id: secondGroupId, name: '아스가르드', memberIds: [member.userId] },
    ]);
  });

  it('prevents duplicate assignment and supports the Flutter source-then-target move flow', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '그룹 이동 길드', 'moveowner');
    const first = await joinGuild(app, owner.guildId, 'MEMBER', 'movefirst');
    const second = await joinGuild(app, owner.guildId, 'MEMBER', 'movesecond');
    const sourceId = await createGroup(app, owner.token, '원본 그룹');
    const targetId = await createGroup(app, owner.token, '대상 그룹');

    expect(
      (await saveMembers(app, owner.token, sourceId, [first.userId, second.userId])).statusCode,
    ).toBe(204);

    const directDuplicate = await saveMembers(app, owner.token, targetId, [first.userId]);
    expect(directDuplicate.statusCode).toBe(409);
    expect(directDuplicate.json()).toMatchObject({
      code: 'CONTENT_GROUP_MEMBER_ALREADY_ASSIGNED',
    });

    const saveSource = await saveMembers(app, owner.token, sourceId, [second.userId]);
    expect(saveSource.statusCode).toBe(204);
    const saveTarget = await saveMembers(app, owner.token, targetId, [first.userId]);
    expect(saveTarget.statusCode).toBe(204);

    const groups = await app.inject({
      method: 'GET',
      url: '/api/v1/content-groups',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(groups.json()).toEqual({
      data: [
        { id: sourceId, name: '원본 그룹', memberIds: [second.userId] },
        { id: targetId, name: '대상 그룹', memberIds: [first.userId] },
      ],
    });
  });

  it('rejects inactive or cross-guild members and records successful mutations', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '그룹 검증 길드', 'validationowner');
    const admin = await joinGuild(app, owner.guildId, 'ADMIN', 'validationadmin');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'validationmember');
    const otherOwner = await createGuild(app, '그룹 외부 길드', 'externalowner');
    const groupId = await createGroup(app, admin.token, '검증 그룹');

    const crossGuildMember = await saveMembers(app, admin.token, groupId, [otherOwner.userId]);
    expect(crossGuildMember.statusCode).toBe(422);
    expect(crossGuildMember.json()).toMatchObject({ code: 'CONTENT_GROUP_MEMBER_INVALID' });

    app.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(member.userId);
    const inactiveMember = await saveMembers(app, admin.token, groupId, [member.userId]);
    expect(inactiveMember.statusCode).toBe(422);

    const audits = app.db
      .prepare('SELECT action FROM content_group_audit_logs WHERE guild_id = ? ORDER BY id ASC')
      .all(owner.guildId) as Array<{ action: string }>;
    expect(audits.map((audit) => audit.action)).toEqual(['GROUP_CREATED']);
  });
});
