import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app';
import { createTestConfig } from '../helpers/test-config';

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

const profileFor = (username: string, nickname: string, combatPower: number) => ({
  username,
  password: 'strong-password',
  nickname,
  occupation: '워리어',
  main_class: '디펜더',
  combat_power: combatPower,
  equipment: {
    무기: { val: `${nickname} 무기`, color: 'hero' },
  },
  skills: {
    active: { '영웅 1': '1강' },
    passive: { '전설 1': 'X' },
  },
});

const createApp = async () => {
  const app = await buildApp(createTestConfig(), { logger: false });
  openApps.push(app);
  return app;
};

const login = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  username: string,
  password = 'strong-password',
) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username, password },
  });
  return { response, token: (response.json() as { token?: string }).token ?? '' };
};

const createGuild = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  guildName: string,
  username: string,
  nickname: string,
) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      mode: 'CREATE_GUILD',
      guild_name: guildName,
      ...profileFor(username, nickname, 200000),
    },
  });
  const registration = response.json() as {
    data: { userId: number; guildId: number };
  };
  const session = await login(app, username);
  return { ...registration.data, token: session.token };
};

const joinGuild = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  guildId: number,
  code: string,
  role: 'MEMBER' | 'ADMIN',
  username: string,
  nickname: string,
  combatPower = 100000,
) => {
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
    payload: {
      mode: 'JOIN_GUILD',
      code,
      ...profileFor(username, nickname, combatPower),
    },
  });
  const registration = response.json() as { userId: number; guildId: number; role: string };
  const session = await login(app, username);
  return { ...registration, token: session.token };
};

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('member list and management routes', () => {
  it('returns full profiles only for the authenticated guild in legacy and v1 shapes', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '아스가르드', 'freya', '프레이야');
    const member = await joinGuild(
      app,
      owner.guildId,
      'ASGARD-MEMBER',
      'MEMBER',
      'thor',
      '토르',
      150000,
    );
    await createGuild(app, '요툰하임', 'loki', '로키');
    app.db
      .prepare(
        `
          INSERT INTO alternate_characters (user_id, character_name, main_class)
          VALUES (?, ?, ?)
        `,
      )
      .run(member.userId, '토르부캐', '버서커');

    const legacyResponse = await app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(legacyResponse.statusCode).toBe(200);
    const legacyMembers = legacyResponse.json() as Array<Record<string, unknown>>;
    expect(legacyMembers).toHaveLength(2);
    expect(legacyMembers.map((item) => item.nickname)).toEqual(['프레이야', '토르']);
    expect(legacyMembers[1]).toMatchObject({
      id: member.userId,
      role: 'MEMBER',
      main_class: '디펜더',
      combat_power: 150000,
      equipment: { 무기: { val: '토르 무기', color: 'hero' } },
      skills: { active: { '영웅 1': '1강' } },
      alternate_characters: [{ character_name: '토르부캐', main_class: '버서커' }],
    });

    const v1Response = await app.inject({
      method: 'GET',
      url: '/api/v1/members',
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(v1Response.statusCode).toBe(200);
    expect(v1Response.json()).toMatchObject({
      data: [
        { nickname: '프레이야', mainClass: '디펜더' },
        { nickname: '토르', combatPower: 150000 },
      ],
    });
  });

  it('changes roles using the current database role and enforces master-only access', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '역할 길드', 'master1', '길드장');
    const member = await joinGuild(
      app,
      owner.guildId,
      'ROLE-MEMBER',
      'MEMBER',
      'member1',
      '길드원1',
    );
    const target = await joinGuild(
      app,
      owner.guildId,
      'ROLE-TARGET',
      'MEMBER',
      'member2',
      '길드원2',
    );

    const denied = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${target.userId}/role`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { role: 'ADMIN' },
    });
    expect(denied.statusCode).toBe(403);

    const promoted = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${member.userId}/role`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { role: 'ADMIN' },
    });
    expect(promoted.statusCode).toBe(204);

    const resetByPromotedAdmin = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${target.userId}/reset-password`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(resetByPromotedAdmin.statusCode).toBe(204);

    const role = app.db.prepare('SELECT role FROM users WHERE id = ?').get(member.userId) as {
      role: string;
    };
    expect(role.role).toBe('ADMIN');
  });

  it('resets a password to 1234 and records the management audit', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '초기화 길드', 'master2', '길드장2');
    const member = await joinGuild(
      app,
      owner.guildId,
      'RESET-MEMBER',
      'MEMBER',
      'resetme',
      '초기화대상',
    );

    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${member.userId}/reset-password`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(response.statusCode).toBe(204);

    const oldLogin = await login(app, 'resetme');
    expect(oldLogin.response.statusCode).toBe(401);
    const resetLogin = await login(app, 'resetme', '1234');
    expect(resetLogin.response.statusCode).toBe(200);

    const audit = app.db
      .prepare(
        `
          SELECT actor_user_id, target_user_id, action
          FROM member_audit_logs
          WHERE guild_id = ?
          ORDER BY id DESC
          LIMIT 1
        `,
      )
      .get(owner.guildId) as {
      actor_user_id: number;
      target_user_id: number;
      action: string;
    };
    expect(audit).toEqual({
      actor_user_id: owner.userId,
      target_user_id: member.userId,
      action: 'PASSWORD_RESET',
    });
  });

  it('transfers master atomically and rejects the old master token for master actions', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '위임 길드', 'master3', '기존길드장');
    const successor = await joinGuild(
      app,
      owner.guildId,
      'TRANSFER-ADMIN',
      'ADMIN',
      'successor',
      '새길드장',
    );

    const transfer = await app.inject({
      method: 'PUT',
      url: '/api/admin/guild/master',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { target_user_id: successor.userId },
    });
    expect(transfer.statusCode).toBe(204);

    const roles = app.db
      .prepare('SELECT id, role FROM users WHERE guild_id = ? ORDER BY id')
      .all(owner.guildId) as Array<{ id: number; role: string }>;
    expect(roles).toEqual([
      { id: owner.userId, role: 'MEMBER' },
      { id: successor.userId, role: 'MASTER' },
    ]);

    const deniedWithStaleMasterToken = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${successor.userId}`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(deniedWithStaleMasterToken.statusCode).toBe(403);

    const audit = app.db
      .prepare('SELECT action FROM member_audit_logs WHERE guild_id = ? ORDER BY id DESC LIMIT 1')
      .get(owner.guildId) as { action: string };
    expect(audit.action).toBe('MASTER_TRANSFERRED');
  });

  it('permanently removes only a member from the same guild and preserves the audit record', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '강퇴 길드', 'master4', '강퇴길드장');
    const member = await joinGuild(
      app,
      owner.guildId,
      'REMOVE-MEMBER',
      'MEMBER',
      'removeme',
      '강퇴대상',
    );
    const otherGuildOwner = await createGuild(app, '다른 길드', 'othermaster', '다른길드장');

    const crossGuild = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${otherGuildOwner.userId}`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(crossGuild.statusCode).toBe(404);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${member.userId}`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(remove.statusCode).toBe(204);
    expect(app.db.prepare('SELECT 1 FROM users WHERE id = ?').get(member.userId)).toBeUndefined();
    expect(
      app.db.prepare('SELECT 1 FROM characters WHERE user_id = ?').get(member.userId),
    ).toBeUndefined();

    const audit = app.db
      .prepare('SELECT target_user_id, action FROM member_audit_logs WHERE guild_id = ?')
      .get(owner.guildId) as { target_user_id: number; action: string };
    expect(audit).toEqual({ target_user_id: member.userId, action: 'MEMBER_REMOVED' });
  });
});
