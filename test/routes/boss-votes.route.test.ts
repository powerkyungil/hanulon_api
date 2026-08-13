import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app';
import { createTestConfig } from '../helpers/test-config';

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
const bossKey = { type: '본섭', region: '요툰하임', boss: '파르바' };

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

const seoulDayStart = (offset = 0): number => {
  const seoul = new Date(Date.now() + 9 * 3_600_000);
  return (
    Date.UTC(seoul.getUTCFullYear(), seoul.getUTCMonth(), seoul.getUTCDate() + offset) -
    9 * 3_600_000
  );
};

const saveTarget = (
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  bosses = ['파르바'],
) =>
  app.inject({
    method: 'POST',
    url: '/api/participation-targets',
    headers: auth(token),
    payload: { bosses },
  });

const saveSchedule = (
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  spawnTime: number,
) =>
  app.inject({
    method: 'POST',
    url: '/api/schedules',
    headers: auth(token),
    payload: [{ ...bossKey, spawnTime }],
  });

const createManualVote = (
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  spawnTime: number,
  boss = '수동 보스',
) =>
  app.inject({
    method: 'POST',
    url: '/api/vote-bosses/manual',
    headers: auth(token),
    payload: {
      type: '본섭',
      region: '수동 지역',
      boss,
      spawnTime,
      isBlessed: true,
    },
  });

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('boss vote routes', () => {
  it('merges current schedules, immutable history, and manual votes in spawn order', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '투표 목록 길드', 'voteowner');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'votemember');
    const todaySpawn = seoulDayStart() + 10 * 3_600_000;
    const tomorrowSpawn = seoulDayStart(1) + 11 * 3_600_000;
    const manualSpawn = seoulDayStart() + 12 * 3_600_000;

    expect((await saveTarget(app, owner.token)).statusCode).toBe(200);
    expect((await saveSchedule(app, owner.token, todaySpawn)).statusCode).toBe(200);
    expect((await saveSchedule(app, owner.token, tomorrowSpawn)).statusCode).toBe(200);
    const manual = await createManualVote(app, owner.token, manualSpawn);
    expect(manual.statusCode).toBe(200);
    const manualId = (manual.json() as { id: number }).id;

    const response = await app.inject({
      method: 'GET',
      url: '/api/vote-bosses',
      headers: auth(member.token),
    });
    expect(response.statusCode).toBe(200);
    const votes = response.json() as Array<{
      voteKey: string;
      spawnTime: number;
      isManual: boolean;
      isHistory: boolean;
    }>;
    expect(votes.map((vote) => vote.spawnTime)).toEqual([todaySpawn, manualSpawn, tomorrowSpawn]);
    expect(votes[0]).toMatchObject({ isManual: false, isHistory: true });
    expect(votes[1]).toMatchObject({
      voteKey: `manual|${manualId}`,
      isManual: true,
      isHistory: false,
    });
    expect(votes[2]).toMatchObject({ isManual: false, isHistory: false });

    const v1 = await app.inject({
      method: 'GET',
      url: '/api/v1/boss-votes',
      headers: auth(owner.token),
    });
    expect((v1.json() as { data: unknown[] }).data).toHaveLength(3);
  });

  it('allows only database staff to create today or tomorrow manual votes and rejects duplicates', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '수동 투표 길드', 'manualowner');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'manualmember');
    const spawnTime = seoulDayStart() + 15 * 3_600_000;

    const denied = await createManualVote(app, member.token, spawnTime);
    expect(denied.statusCode).toBe(403);

    app.db.prepare("UPDATE users SET role = 'ADMIN' WHERE id = ?").run(member.userId);
    const created = await createManualVote(app, member.token, spawnTime);
    expect(created.statusCode).toBe(200);

    const duplicate = await createManualVote(app, owner.token, spawnTime);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'BOSS_VOTE_EXISTS' });

    const tooLate = await createManualVote(app, owner.token, seoulDayStart(2) + 1_000, '늦은 보스');
    expect(tooLate.statusCode).toBe(422);
    expect(tooLate.json()).toMatchObject({ code: 'MANUAL_VOTE_TIME_OUT_OF_RANGE' });
  });

  it('toggles participation transactionally and returns participant and joined state', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '투표 참여 길드', 'joinvoteowner');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'joinvotemember');
    const spawnTime = seoulDayStart() + 16 * 3_600_000;
    const created = await createManualVote(app, owner.token, spawnTime);
    const voteKey = `manual|${(created.json() as { id: number }).id}`;
    const url = `/api/vote-participants/${encodeURIComponent(voteKey)}`;

    const joined = await app.inject({
      method: 'POST',
      url,
      headers: auth(member.token),
      payload: { boss: '수동 보스', spawnTime },
    });
    expect(joined.statusCode).toBe(200);
    expect(joined.json()).toEqual({ joined: true });

    const list = await app.inject({
      method: 'GET',
      url: '/api/vote-bosses',
      headers: auth(member.token),
    });
    expect(list.json()).toEqual([
      expect.objectContaining({
        voteKey,
        joined: true,
        participants: [{ userId: member.userId, nickname: 'joinvotemember' }],
      }),
    ]);

    const canceled = await app.inject({
      method: 'PUT',
      url: `/api/v1/boss-votes/${encodeURIComponent(voteKey)}/participation`,
      headers: auth(member.token),
      payload: { boss: '수동 보스', spawnTime },
    });
    expect(canceled.json()).toEqual({ data: { joined: false } });

    const count = app.db
      .prepare(
        'SELECT COUNT(*) AS count FROM boss_participants WHERE guild_id = ? AND vote_key = ?',
      )
      .get(owner.guildId, voteKey) as { count: number };
    expect(count.count).toBe(0);
  });

  it('blocks closed, spoofed, and cross-guild votes and hides deleted votes', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '투표 상태 길드', 'statevoteowner');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'statevotemember');
    const otherOwner = await createGuild(app, '외부 투표 길드', 'othervoteowner');
    const spawnTime = seoulDayStart() + 17 * 3_600_000;
    const created = await createManualVote(app, owner.token, spawnTime);
    const voteKey = `manual|${(created.json() as { id: number }).id}`;

    const crossGuild = await app.inject({
      method: 'POST',
      url: `/api/vote-participants/${encodeURIComponent(voteKey)}`,
      headers: auth(otherOwner.token),
      payload: { boss: '수동 보스', spawnTime },
    });
    expect(crossGuild.statusCode).toBe(404);

    const spoofed = await app.inject({
      method: 'POST',
      url: `/api/vote-participants/${encodeURIComponent(voteKey)}`,
      headers: auth(member.token),
      payload: { boss: '다른 보스', spawnTime },
    });
    expect(spoofed.statusCode).toBe(404);

    app.db
      .prepare(
        `
          INSERT INTO participation_states (guild_id, vote_key, spawn_time, state, updated_by)
          VALUES (?, ?, ?, 'INACTIVE', ?)
        `,
      )
      .run(owner.guildId, voteKey, spawnTime, owner.userId);
    const closed = await app.inject({
      method: 'POST',
      url: `/api/vote-participants/${encodeURIComponent(voteKey)}`,
      headers: auth(member.token),
      payload: { boss: '수동 보스', spawnTime },
    });
    expect(closed.statusCode).toBe(409);
    expect(closed.json()).toMatchObject({ code: 'BOSS_VOTE_CLOSED' });

    app.db
      .prepare(
        `
          UPDATE participation_states
          SET state = 'DELETED', updated_at = CURRENT_TIMESTAMP
          WHERE guild_id = ? AND vote_key = ?
        `,
      )
      .run(owner.guildId, voteKey);
    const list = await app.inject({
      method: 'GET',
      url: '/api/vote-bosses',
      headers: auth(owner.token),
    });
    expect(list.json()).toEqual([]);
  }, 15_000);
});
