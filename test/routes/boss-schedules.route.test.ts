import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app';
import { createTestConfig } from '../helpers/test-config';

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
const scheduleInput = {
  type: '본섭',
  region: '요툰하임',
  boss: '파르바',
  spawnTime: 1_786_406_400_000,
};

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

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const saveSchedule = (
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  input = scheduleInput,
) =>
  app.inject({
    method: 'POST',
    url: '/api/schedules',
    headers: auth(token),
    payload: [input],
  });

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('boss definition and schedule routes', () => {
  it('seeds default bosses per guild and allows only current database staff to manage them', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '보스 정의 길드', 'bossowner');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'bossmember');
    const otherOwner = await createGuild(app, '다른 보스 길드', 'otherbossowner');

    const defaults = await app.inject({
      method: 'GET',
      url: '/api/custom-bosses',
      headers: auth(member.token),
    });
    expect(defaults.statusCode).toBe(200);
    const defaultRows = defaults.json() as Array<{ id: number; boss: string; cooldown: number }>;
    expect(defaultRows.length).toBeGreaterThan(80);
    expect(defaultRows).toContainEqual(expect.objectContaining({ boss: '파르바', cooldown: 12 }));

    const denied = await app.inject({
      method: 'POST',
      url: '/api/custom-bosses',
      headers: auth(member.token),
      payload: { type: '본섭', region: '테스트', boss: '테스트 보스', cooldown: 6 },
    });
    expect(denied.statusCode).toBe(403);

    app.db.prepare("UPDATE users SET role = 'ADMIN' WHERE id = ?").run(member.userId);
    const created = await app.inject({
      method: 'POST',
      url: '/api/custom-bosses',
      headers: auth(member.token),
      payload: { type: '본섭', region: '테스트', boss: '테스트 보스', cooldown: 6 },
    });
    expect(created.statusCode).toBe(200);
    const createdId = (created.json() as { id: number }).id;

    const isolated = await app.inject({
      method: 'DELETE',
      url: `/api/custom-bosses/${createdId}`,
      headers: auth(otherOwner.token),
    });
    expect(isolated.statusCode).toBe(404);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/bosses/${createdId}`,
      headers: auth(owner.token),
    });
    expect(deleted.statusCode).toBe(204);
  }, 15_000);

  it('saves schedules idempotently, returns both contracts, and keeps immutable occurrence history', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '일정 저장 길드', 'scheduleowner');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'schedulemember');

    const denied = await saveSchedule(app, member.token);
    expect(denied.statusCode).toBe(403);
    expect((await saveSchedule(app, owner.token)).statusCode).toBe(200);
    expect((await saveSchedule(app, owner.token)).statusCode).toBe(200);

    const legacy = await app.inject({
      method: 'GET',
      url: '/api/schedules',
      headers: auth(member.token),
    });
    expect(legacy.json()).toEqual([
      expect.objectContaining({
        ...scheduleInput,
        id: expect.any(Number),
        is_mung: 0,
        isFixed: false,
      }),
    ]);

    const v1 = await app.inject({
      method: 'GET',
      url: '/api/v1/schedules',
      headers: auth(owner.token),
    });
    expect(v1.json()).toEqual({
      data: [
        expect.objectContaining({
          ...scheduleInput,
          bossDefinitionId: expect.any(Number),
          isMung: false,
        }),
      ],
    });

    const historyCount = app.db
      .prepare('SELECT COUNT(*) AS count FROM schedule_history WHERE guild_id = ?')
      .get(owner.guildId) as { count: number };
    expect(historyCount.count).toBe(1);
  });

  it('uses boss definition IDs for v1 schedules and participation targets', async () => {
    const app = await createApp();
    const owner = await createGuild(app, 'ID 참여 설정 길드', 'targetidowner');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/bosses',
          headers: auth(owner.token),
        })
      ).statusCode,
    ).toBe(200);
    const definition = app.db
      .prepare(
        'SELECT id FROM boss_definitions WHERE guild_id = ? AND type = ? AND region = ? AND boss = ?',
      )
      .get(owner.guildId, scheduleInput.type, scheduleInput.region, scheduleInput.boss) as { id: number };

    const saved = await app.inject({
      method: 'POST',
      url: '/api/v1/schedules',
      headers: auth(owner.token),
      payload: { schedules: [{ ...scheduleInput, bossDefinitionId: definition.id }] },
    });
    expect(saved.statusCode).toBe(201);

    const updated = await app.inject({
      method: 'PUT',
      url: '/api/v1/participation-targets',
      headers: auth(owner.token),
      payload: { bossDefinitionIds: [definition.id] },
    });
    expect(updated.statusCode).toBe(204);

    const invasion = await app.inject({
      method: 'POST',
      url: '/api/v1/bosses',
      headers: auth(owner.token),
      payload: {
        type: '침공',
        region: '참여 설정 시험 지역',
        boss: scheduleInput.boss,
        cooldownHours: 4,
      },
    });
    expect(invasion.statusCode).toBe(201);
    const invasionDefinitionId = (invasion.json() as { data: { id: number } }).data.id;

    const independentlyUpdated = await app.inject({
      method: 'PUT',
      url: '/api/v1/participation-targets',
      headers: auth(owner.token),
      payload: { bossDefinitionIds: [definition.id, invasionDefinitionId] },
    });
    expect(independentlyUpdated.statusCode).toBe(204);

    const targets = await app.inject({
      method: 'GET',
      url: '/api/v1/participation-targets',
      headers: auth(owner.token),
    });
    expect(targets.json()).toEqual({
      data: { bossDefinitionIds: [definition.id, invasionDefinitionId] },
    });

    const states = await app.inject({
      method: 'GET',
      url: '/api/v1/participation-states',
      headers: auth(owner.token),
    });
    expect(states.statusCode).toBe(200);
    expect(states.json()).toEqual({ data: [] });
  });

  it('calculates cut from server time and mung from the verified current occurrence', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '컷 멍 길드', 'actionowner');
    expect((await saveSchedule(app, owner.token)).statusCode).toBe(200);

    const mung = await app.inject({
      method: 'POST',
      url: '/api/schedules/mung',
      headers: auth(owner.token),
      payload: {
        type: scheduleInput.type,
        region: scheduleInput.region,
        boss: scheduleInput.boss,
        currentSpawnTime: scheduleInput.spawnTime,
      },
    });
    expect(mung.statusCode).toBe(200);
    expect(mung.json()).toEqual({
      success: true,
      nextSpawn: scheduleInput.spawnTime + 12 * 3_600_000,
    });

    const staleMung = await app.inject({
      method: 'POST',
      url: '/api/schedules/mung',
      headers: auth(owner.token),
      payload: {
        type: scheduleInput.type,
        region: scheduleInput.region,
        boss: scheduleInput.boss,
        currentSpawnTime: scheduleInput.spawnTime,
      },
    });
    expect(staleMung.statusCode).toBe(409);
    expect(staleMung.json()).toMatchObject({ code: 'SCHEDULE_CURRENT_SPAWN_MISMATCH' });

    const beforeCut = Date.now();
    const cut = await app.inject({
      method: 'POST',
      url: '/api/v1/schedules/cut',
      headers: auth(owner.token),
      payload: {
        type: scheduleInput.type,
        region: scheduleInput.region,
        boss: scheduleInput.boss,
      },
    });
    const nextSpawnTime = (cut.json() as { data: { nextSpawnTime: number } }).data.nextSpawnTime;
    expect(nextSpawnTime).toBeGreaterThanOrEqual(beforeCut + 12 * 3_600_000);
    expect(nextSpawnTime).toBeLessThanOrEqual(Date.now() + 12 * 3_600_000);
  });

  it('manages participation targets and toggles occurrence participation without cross-guild leaks', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '참여 일정 길드', 'participantowner');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'participantmember');
    const otherOwner = await createGuild(app, '외부 참여 길드', 'otherparticipant');
    expect((await saveSchedule(app, owner.token)).statusCode).toBe(200);

    const deniedTargets = await app.inject({
      method: 'POST',
      url: '/api/participation-targets',
      headers: auth(member.token),
      payload: { bosses: ['파르바'] },
    });
    expect(deniedTargets.statusCode).toBe(403);

    const targets = await app.inject({
      method: 'POST',
      url: '/api/participation-targets',
      headers: auth(owner.token),
      payload: { bosses: ['파르바'] },
    });
    expect(targets.statusCode).toBe(200);

    const toggleUrl = `/api/participants/${encodeURIComponent(scheduleInput.boss)}`;
    const joined = await app.inject({
      method: 'POST',
      url: toggleUrl,
      headers: auth(member.token),
      payload: {
        type: scheduleInput.type,
        region: scheduleInput.region,
        spawnTime: scheduleInput.spawnTime,
      },
    });
    expect(joined.json()).toEqual({ joined: true });

    const participants = await app.inject({
      method: 'GET',
      url: '/api/participants',
      headers: auth(owner.token),
    });
    const voteKey = `${scheduleInput.type}|${scheduleInput.region}|${scheduleInput.boss}|${scheduleInput.spawnTime}`;
    expect(participants.json()).toEqual({ [voteKey]: ['participantmember'] });

    const isolated = await app.inject({
      method: 'GET',
      url: '/api/participants',
      headers: auth(otherOwner.token),
    });
    expect(isolated.json()).toEqual({});

    app.db
      .prepare(
        `
          INSERT INTO participation_states (guild_id, vote_key, spawn_time, state, updated_by)
          VALUES (?, ?, ?, 'INACTIVE', ?)
        `,
      )
      .run(owner.guildId, voteKey, scheduleInput.spawnTime, owner.userId);
    const closed = await app.inject({
      method: 'POST',
      url: toggleUrl,
      headers: auth(member.token),
      payload: {
        type: scheduleInput.type,
        region: scheduleInput.region,
        spawnTime: scheduleInput.spawnTime,
      },
    });
    expect(closed.statusCode).toBe(409);
    expect(closed.json()).toMatchObject({ code: 'PARTICIPATION_CLOSED' });
  }, 15_000);

  it('deletes and resets only the current guild schedules while preserving history and audits', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '일정 초기화 길드', 'resetowner');
    const otherOwner = await createGuild(app, '일정 유지 길드', 'keepowner');
    expect((await saveSchedule(app, owner.token)).statusCode).toBe(200);
    expect((await saveSchedule(app, otherOwner.token)).statusCode).toBe(200);

    const reset = await app.inject({
      method: 'DELETE',
      url: '/api/schedules-all',
      headers: auth(owner.token),
    });
    expect(reset.statusCode).toBe(200);

    const own = await app.inject({
      method: 'GET',
      url: '/api/schedules',
      headers: auth(owner.token),
    });
    const other = await app.inject({
      method: 'GET',
      url: '/api/schedules',
      headers: auth(otherOwner.token),
    });
    expect(own.json()).toEqual([]);
    expect(other.json()).toHaveLength(1);

    const history = app.db
      .prepare('SELECT COUNT(*) AS count FROM schedule_history WHERE guild_id = ?')
      .get(owner.guildId) as { count: number };
    const audit = app.db
      .prepare(
        "SELECT metadata_json FROM schedule_audit_logs WHERE guild_id = ? AND action = 'SCHEDULES_RESET'",
      )
      .get(owner.guildId) as { metadata_json: string };
    expect(history.count).toBe(1);
    expect(JSON.parse(audit.metadata_json)).toEqual({ removedCount: 1 });
  });
});
