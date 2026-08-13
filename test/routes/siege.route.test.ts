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
  combatPower = 120000,
) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      mode: 'CREATE_GUILD',
      guild_name: guildName,
      ...profileFor(username, `${username} 길드장`, combatPower),
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
  combatPower = 120000,
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
    payload: {
      mode: 'JOIN_GUILD',
      code,
      ...profileFor(username, username, combatPower),
    },
  });
  expect(response.statusCode).toBe(201);
  const data = response.json() as { userId: number };
  return { ...data, token: await login(app, username) };
};

const saveMine = (
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  currentDiamonds: number,
  remainingDiamonds: number,
) =>
  app.inject({
    method: 'PUT',
    url: '/api/siege/me',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      current_diamonds: currentDiamonds,
      remaining_diamonds: remainingDiamonds,
    },
  });

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('siege routes', () => {
  it('returns active guild members in combat-power order and supports legacy and v1 self input', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '공성 현황 길드', 'siegeowner', 100000);
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'siegemember', 180000);
    await createGuild(app, '다른 공성 길드', 'othersiegeowner', 300000);

    const saved = await saveMine(app, member.token, 80000, 35000);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ success: true });

    const legacy = await app.inject({
      method: 'GET',
      url: '/api/siege',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json()).toEqual([
      expect.objectContaining({
        id: member.userId,
        current_diamonds: 80000,
        remaining_diamonds: 35000,
        updated_at: expect.any(String),
      }),
      expect.objectContaining({
        id: owner.userId,
        current_diamonds: 0,
        remaining_diamonds: 0,
        updated_at: null,
      }),
    ]);

    const v1Save = await app.inject({
      method: 'PUT',
      url: '/api/v1/siege/me',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { currentDiamonds: 50000, remainingDiamonds: 20000 },
    });
    expect(v1Save.statusCode).toBe(204);

    const v1 = await app.inject({
      method: 'GET',
      url: '/api/v1/siege',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(v1.json()).toMatchObject({
      data: [
        { userId: member.userId, usedDiamonds: 45000 },
        {
          userId: owner.userId,
          currentDiamonds: 50000,
          remainingDiamonds: 20000,
          usedDiamonds: 30000,
        },
      ],
    });
  }, 15_000);

  it('rejects invalid diamond ranges and remaining diamonds greater than the starting value', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '공성 검증 길드', 'siegevalidation');

    const outOfRange = await saveMine(app, owner.token, 1_000_000_000, 0);
    expect(outOfRange.statusCode).toBe(400);
    expect(outOfRange.json()).toMatchObject({ code: 'VALIDATION_ERROR' });

    const invalidRemaining = await saveMine(app, owner.token, 10000, 10001);
    expect(invalidRemaining.statusCode).toBe(422);
    expect(invalidRemaining.json()).toMatchObject({
      code: 'SIEGE_REMAINING_EXCEEDS_CURRENT',
    });
  });

  it('rechecks staff roles from the database and prevents cross-guild member updates', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '공성 권한 길드', 'siegeauthowner');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'siegeauthmember');
    const target = await joinGuild(app, owner.guildId, 'MEMBER', 'siegetarget');
    const otherOwner = await createGuild(app, '외부 공성 길드', 'externalsiegeowner');

    const denied = await app.inject({
      method: 'PUT',
      url: `/api/admin/siege/${target.userId}`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { current_diamonds: 10000, remaining_diamonds: 5000 },
    });
    expect(denied.statusCode).toBe(403);

    app.db.prepare("UPDATE users SET role = 'ADMIN' WHERE id = ?").run(member.userId);
    const allowed = await app.inject({
      method: 'PUT',
      url: `/api/v1/siege/members/${target.userId}`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { currentDiamonds: 10000, remainingDiamonds: 5000 },
    });
    expect(allowed.statusCode).toBe(204);

    const crossGuild = await app.inject({
      method: 'PUT',
      url: `/api/admin/siege/${otherOwner.userId}`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { current_diamonds: 10000, remaining_diamonds: 5000 },
    });
    expect(crossGuild.statusCode).toBe(404);
    expect(crossGuild.json()).toMatchObject({ code: 'SIEGE_MEMBER_NOT_FOUND' });
  }, 15_000);

  it('resets only the current guild and records the destructive action in the audit log', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '공성 초기화 길드', 'siegeresetowner');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'siegeresetmember');
    const otherOwner = await createGuild(app, '공성 유지 길드', 'siegekeepowner');
    expect((await saveMine(app, member.token, 90000, 40000)).statusCode).toBe(200);
    expect((await saveMine(app, otherOwner.token, 70000, 30000)).statusCode).toBe(200);

    const reset = await app.inject({
      method: 'DELETE',
      url: '/api/siege/all',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual({ success: true });

    const ownRecords = await app.inject({
      method: 'GET',
      url: '/api/siege',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(
      (ownRecords.json() as Array<{ current_diamonds: number }>).every(
        (record) => record.current_diamonds === 0,
      ),
    ).toBe(true);

    const otherRecords = await app.inject({
      method: 'GET',
      url: '/api/siege',
      headers: { authorization: `Bearer ${otherOwner.token}` },
    });
    expect(otherRecords.json()).toEqual([
      expect.objectContaining({ current_diamonds: 70000, remaining_diamonds: 30000 }),
    ]);

    const audit = app.db
      .prepare(
        `
          SELECT action, metadata_json
          FROM siege_audit_logs
          WHERE guild_id = ? AND action = 'ALL_RESET'
        `,
      )
      .get(owner.guildId) as { action: string; metadata_json: string };
    expect(audit.action).toBe('ALL_RESET');
    expect(JSON.parse(audit.metadata_json)).toEqual({ resetCount: 1 });
  }, 15_000);
});
