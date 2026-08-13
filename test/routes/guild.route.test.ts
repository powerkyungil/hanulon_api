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
  nickname: string,
) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      mode: 'CREATE_GUILD',
      guild_name: guildName,
      ...profileFor(username, nickname),
    },
  });
  const data = (response.json() as { data: { userId: number; guildId: number } }).data;
  return { ...data, token: await login(app, username) };
};

const joinGuild = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  guildId: number,
  code: string,
  role: 'MEMBER' | 'ADMIN',
  username: string,
) => {
  app.db
    .prepare('INSERT INTO invites (guild_id, code, role) VALUES (?, ?, ?)')
    .run(guildId, code, role);
  const response = await app.inject({
    method: 'POST',
    url: '/api/users/register',
    payload: {
      mode: 'JOIN_GUILD',
      code,
      ...profileFor(username, username),
    },
  });
  const data = response.json() as { userId: number; guildId: number };
  return { ...data, token: await login(app, username) };
};

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('guild settings routes', () => {
  it('allows active members to read public settings but only master can save them', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '공개 설정 길드', 'settingsmaster', '길드장');
    const member = await joinGuild(
      app,
      owner.guildId,
      'SETTINGS-MEMBER',
      'MEMBER',
      'settingsmember',
    );

    const legacyRead = await app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(legacyRead.statusCode).toBe(200);
    expect(legacyRead.json()).toEqual({
      guild_name: '공개 설정 길드',
      allow_member_combat_power_edit: 1,
    });
    expect(legacyRead.json()).not.toHaveProperty('discord_token');

    const v1Read = await app.inject({
      method: 'GET',
      url: '/api/v1/guild/settings',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(v1Read.statusCode).toBe(200);
    expect(v1Read.json()).toEqual({
      data: {
        guildName: '공개 설정 길드',
        allowMemberCombatPowerEdit: true,
      },
    });

    const denied = await app.inject({
      method: 'POST',
      url: '/api/settings',
      headers: { authorization: `Bearer ${member.token}` },
      payload: {
        guild_name: '권한 없는 변경',
        allow_member_combat_power_edit: 0,
        discord_token: 'must-not-be-stored',
        discord_channel_id: 'channel',
        discord_enabled: 1,
      },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('updates both guild name records, ignores Discord fields, audits, and rejects duplicates', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '설정 변경 전', 'renameowner', '변경길드장');
    await createGuild(app, '이미 있는 길드', 'duplicateowner', '다른길드장');

    const update = await app.inject({
      method: 'POST',
      url: '/api/settings',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: {
        guild_name: '설정 변경 후',
        allow_member_combat_power_edit: 0,
        discord_token: 'ignored-secret',
        discord_channel_id: 'ignored-channel',
        discord_enabled: 1,
      },
    });
    expect(update.statusCode).toBe(204);

    const stored = app.db
      .prepare(
        `
          SELECT g.name, gs.guild_name, gs.allow_member_combat_power_edit
          FROM guilds AS g
          JOIN guild_settings AS gs ON gs.guild_id = g.id
          WHERE g.id = ?
        `,
      )
      .get(owner.guildId) as {
      name: string;
      guild_name: string;
      allow_member_combat_power_edit: number;
    };
    expect(stored).toEqual({
      name: '설정 변경 후',
      guild_name: '설정 변경 후',
      allow_member_combat_power_edit: 0,
    });

    const audit = app.db
      .prepare('SELECT action, metadata_json FROM guild_audit_logs WHERE guild_id = ?')
      .get(owner.guildId) as { action: string; metadata_json: string };
    expect(audit.action).toBe('SETTINGS_UPDATED');
    expect(audit.metadata_json).not.toContain('ignored-secret');

    const duplicate = await app.inject({
      method: 'PUT',
      url: '/api/v1/guild/settings',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: {
        guildName: '이미 있는 길드',
        allowMemberCombatPowerEdit: true,
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: { code: 'GUILD_NAME_EXISTS' } });
  });
});

describe('guild invite routes', () => {
  it('creates and lists role-based custom codes, then immediately revokes the previous code', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '가입 코드 길드', 'inviteowner', '코드길드장');

    const memberInvite = await app.inject({
      method: 'POST',
      url: '/api/invites',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { targetRole: 'MEMBER', customCode: 'odin-2026' },
    });
    expect(memberInvite.statusCode).toBe(200);
    expect(memberInvite.json()).toEqual({ inviteCode: 'ODIN-2026', role: 'MEMBER' });

    const adminInvite = await app.inject({
      method: 'POST',
      url: '/api/invites',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { targetRole: 'ADMIN', customCode: 'ADMIN-2026' },
    });
    expect(adminInvite.statusCode).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: '/api/invites',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({
      invites: [
        { inviteCode: 'ODIN-2026', role: 'MEMBER' },
        { inviteCode: 'ADMIN-2026', role: 'ADMIN' },
      ],
    });

    const replaced = await app.inject({
      method: 'POST',
      url: '/api/invites',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { targetRole: 'MEMBER', customCode: 'ODIN-NEW' },
    });
    expect(replaced.statusCode).toBe(200);

    const oldCodeJoin = await app.inject({
      method: 'POST',
      url: '/api/users/register',
      payload: {
        mode: 'JOIN_GUILD',
        code: 'ODIN-2026',
        ...profileFor('oldcodeuser', '이전코드'),
      },
    });
    expect(oldCodeJoin.statusCode).toBe(422);
    expect(oldCodeJoin.json()).toMatchObject({ code: 'INVITE_CODE_INVALID' });

    const newCodeJoin = await app.inject({
      method: 'POST',
      url: '/api/users/register',
      payload: {
        mode: 'JOIN_GUILD',
        code: 'ODIN-NEW',
        ...profileFor('newcodeuser', '새코드'),
      },
    });
    expect(newCodeJoin.statusCode).toBe(201);

    const auditCount = app.db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM guild_audit_logs
          WHERE guild_id = ? AND action = 'INVITE_REPLACED'
        `,
      )
      .get(owner.guildId) as { count: number };
    expect(auditCount.count).toBe(3);
  });

  it('generates a random code, enforces global uniqueness, and isolates invite lists by guild', async () => {
    const app = await createApp();
    const first = await createGuild(app, '첫 번째 코드 길드', 'firstowner', '첫길드장');
    const second = await createGuild(app, '두 번째 코드 길드', 'secondowner', '둘째길드장');

    const generated = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invites',
      headers: { authorization: `Bearer ${first.token}` },
      payload: { targetRole: 'MEMBER' },
    });
    expect(generated.statusCode).toBe(200);
    const generatedInvite = generated.json() as {
      data: { inviteCode: string; role: string };
    };
    expect(generatedInvite.data.inviteCode).toMatch(/^MEMBER-[A-F0-9]{8}$/);

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/invites',
      headers: { authorization: `Bearer ${second.token}` },
      payload: {
        targetRole: 'ADMIN',
        customCode: generatedInvite.data.inviteCode,
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'INVITE_CODE_EXISTS' });

    const secondList = await app.inject({
      method: 'GET',
      url: '/api/invites',
      headers: { authorization: `Bearer ${second.token}` },
    });
    expect(secondList.json()).toEqual({ invites: [] });
  });

  it('uses the latest database role immediately after master transfer', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '권한 갱신 길드', 'oldmaster', '기존길드장');
    const successor = await joinGuild(app, owner.guildId, 'SUCCESSOR-CODE', 'ADMIN', 'newmaster');

    const transfer = await app.inject({
      method: 'PUT',
      url: '/api/admin/guild/master',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { target_user_id: successor.userId },
    });
    expect(transfer.statusCode).toBe(204);

    const oldMasterDenied = await app.inject({
      method: 'GET',
      url: '/api/invites',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(oldMasterDenied.statusCode).toBe(403);

    const newMasterAllowed = await app.inject({
      method: 'GET',
      url: '/api/invites',
      headers: { authorization: `Bearer ${successor.token}` },
    });
    expect(newMasterAllowed.statusCode).toBe(200);
  });
});
