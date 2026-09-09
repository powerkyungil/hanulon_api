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
    const tomorrowSpawn = todaySpawn + 12 * 3_600_000;
    const manualSpawn = seoulDayStart() + 12 * 3_600_000;

    expect((await saveTarget(app, owner.token)).statusCode).toBe(200);
    expect((await saveSchedule(app, owner.token, todaySpawn)).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/schedules/mung',
          headers: auth(owner.token),
          payload: { ...bossKey, currentSpawnTime: todaySpawn },
        })
      ).statusCode,
    ).toBe(200);
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

  it('moves a corrected vote with participants, supports retries and undo, and hides it on deletion', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '시간 수정 길드', 'timeowner');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'timemember');
    const spawnTime = seoulDayStart() + 10 * 3_600_000;
    const changedTime = spawnTime + 62_922;
    const key = (time: number) => `${bossKey.type}|${bossKey.region}|${bossKey.boss}|${time}`;
    const list = async () =>
      (
        await app.inject({
          method: 'GET',
          url: '/api/vote-bosses',
          headers: auth(member.token),
        })
      ).json() as Array<{ id: number; voteKey: string }>;
    await saveTarget(app, owner.token);
    await saveSchedule(app, owner.token, spawnTime);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/vote-participants/${encodeURIComponent(key(spawnTime))}`,
          headers: auth(member.token),
          payload: { boss: bossKey.boss, spawnTime },
        })
      ).json(),
    ).toEqual({ joined: true });
    for (const time of [changedTime, changedTime, spawnTime, changedTime]) {
      expect((await saveSchedule(app, member.token, time)).statusCode).toBe(200);
      expect(await list()).toEqual([
        expect.objectContaining({
          voteKey: key(time),
          spawnTime: time,
          joined: true,
          participantCount: 1,
          isHistory: false,
          participants: [{ userId: member.userId, nickname: 'timemember' }],
        }),
      ]);
    }
    const stale = await app.inject({
      method: 'POST',
      url: `/api/vote-participants/${encodeURIComponent(key(spawnTime))}`,
      headers: auth(member.token),
      payload: { boss: bossKey.boss, spawnTime },
    });
    expect(stale.statusCode).toBe(404);
    // A failure after participant movement must restore the entire occurrence.
    app.db.exec(`CREATE TEMP TRIGGER reject_corrected_schedule BEFORE INSERT ON boss_schedules
      BEGIN SELECT RAISE(ABORT, 'test schedule insert failure'); END;`);
    expect((await saveSchedule(app, member.token, changedTime + 1)).statusCode).toBe(500);
    app.db.exec('DROP TRIGGER reject_corrected_schedule');
    expect(await list()).toEqual([
      expect.objectContaining({
        voteKey: key(changedTime),
        participantCount: 1,
        joined: true,
      }),
    ]);
    const month = new Date(spawnTime + 9 * 3_600_000).toISOString().slice(0, 7);
    const stats = async () =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/vote-stats?month=${month}`,
          headers: auth(owner.token),
        })
      ).json();
    expect(await stats()).toMatchObject({ totalBosses: 1, totalParticipants: 1 });
    const [vote] = await list();
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/schedules/${vote?.id}`,
          headers: auth(member.token),
        })
      ).statusCode,
    ).toBe(204);
    expect(await list()).toEqual([]);
    expect(await stats()).toMatchObject({ totalBosses: 0, totalParticipants: 0 });
    expect(
      app.db
        .prepare('SELECT COUNT(*) AS count FROM boss_participants WHERE guild_id = ?')
        .get(owner.guildId),
    ).toEqual({ count: 1 });
    expect(
      app.db
        .prepare('SELECT COUNT(*) AS count FROM schedule_history WHERE guild_id = ?')
        .get(owner.guildId),
    ).toEqual({ count: 2 });
  });

  it('keeps cut/mung votes and closed state, rejects collisions, and resets only current votes', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '이력 유지 길드', 'historyowner');
    const other = await createGuild(app, '다른 이력 길드', 'historyother');
    const spawnTime = seoulDayStart() + 3_600_000;
    for (const guild of [owner, other]) {
      await saveTarget(app, guild.token);
      await saveSchedule(app, guild.token, spawnTime);
    }
    const key = (time: number) => `${bossKey.type}|${bossKey.region}|${bossKey.boss}|${time}`;
    app.db
      .prepare(
        `INSERT INTO participation_states (guild_id, vote_key, spawn_time, state, updated_by)
      VALUES (?, ?, ?, 'INACTIVE', ?)`,
      )
      .run(owner.guildId, key(spawnTime), spawnTime, owner.userId);
    const corrected = spawnTime + 60_000;
    expect((await saveSchedule(app, owner.token, corrected)).statusCode).toBe(200);
    const list = async (token = owner.token) =>
      (
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/boss-votes',
            headers: auth(token),
          })
        ).json() as { data: Array<{ voteKey: string; isHistory: boolean }> }
      ).data;
    expect(await list()).toEqual([
      expect.objectContaining({ voteKey: key(corrected), isClosed: true }),
    ]);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/schedules/mung',
          headers: auth(owner.token),
          payload: { ...bossKey, currentSpawnTime: corrected },
        })
      ).statusCode,
    ).toBe(200);
    expect(await list()).toEqual([
      expect.objectContaining({ voteKey: key(corrected), isHistory: true, isClosed: true }),
      expect.objectContaining({
        voteKey: key(corrected + 12 * 3_600_000),
        isHistory: false,
        isClosed: false,
      }),
    ]);
    const conflict = await saveSchedule(app, owner.token, corrected);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'SCHEDULE_VOTE_CONFLICT' });
    expect(await list()).toHaveLength(2);
    const cut = await app.inject({
      method: 'POST',
      url: '/api/schedules/cut',
      headers: auth(owner.token),
      payload: bossKey,
    });
    expect(cut.statusCode).toBe(200);
    expect(await list()).toHaveLength(3);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/api/schedules-all',
          headers: auth(owner.token),
        })
      ).statusCode,
    ).toBe(200);
    expect(await list()).toEqual([
      expect.objectContaining({ voteKey: key(corrected), isHistory: true }),
      expect.objectContaining({ voteKey: key(corrected + 12 * 3_600_000), isHistory: true }),
    ]);
    expect(await list(other.token)).toEqual([
      expect.objectContaining({ voteKey: key(spawnTime), isHistory: false }),
    ]);
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

  it('supports legacy close, participant removal, monthly stats, and member rates', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '투표 관리 길드', 'managevoteowner');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'managevotemember');
    const spawnTime = seoulDayStart() + 14 * 3_600_000;
    const created = await createManualVote(app, owner.token, spawnTime);
    const manualId = (created.json() as { id: number }).id;
    const voteKey = `manual|${manualId}`;
    const encodedVoteKey = encodeURIComponent(voteKey);

    const joined = await app.inject({
      method: 'POST',
      url: `/api/vote-participants/${encodedVoteKey}`,
      headers: auth(member.token),
      payload: { boss: '수동 보스', spawnTime },
    });
    expect(joined.statusCode).toBe(200);

    const seoulDate = new Date(spawnTime + 9 * 3_600_000).toISOString().slice(0, 10);
    const month = seoulDate.slice(0, 7);
    const stats = await app.inject({
      method: 'GET',
      url: `/api/vote-stats?month=${month}`,
      headers: auth(owner.token),
    });
    expect(stats.statusCode).toBe(200);
    expect(stats.json()).toMatchObject({
      month,
      totalBosses: 1,
      totalParticipants: 1,
      days: [
        {
          date: seoulDate,
          totalParticipants: 1,
          bosses: [
            {
              voteKey,
              participantCount: 1,
              participants: [{ userId: member.userId, nickname: 'managevotemember' }],
            },
          ],
        },
      ],
    });

    const rates = await app.inject({
      method: 'GET',
      url: `/api/vote-member-rates?start=${seoulDate}&end=${seoulDate}`,
      headers: auth(owner.token),
    });
    expect(rates.statusCode).toBe(200);
    expect(rates.json()).toMatchObject({
      start: seoulDate,
      end: seoulDate,
      totalBosses: 1,
      memberCount: 2,
      members: expect.arrayContaining([
        expect.objectContaining({
          userId: member.userId,
          joinedCount: 1,
          totalBosses: 1,
          rate: 100,
        }),
      ]),
    });

    const memberDenied = await app.inject({
      method: 'DELETE',
      url: `/api/vote-participants/${encodedVoteKey}/users/${member.userId}`,
      headers: auth(member.token),
    });
    expect(memberDenied.statusCode).toBe(403);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/vote-participants/${encodedVoteKey}/users/${member.userId}`,
      headers: auth(owner.token),
    });
    expect(removed.json()).toEqual({ success: true });

    const closed = await app.inject({
      method: 'DELETE',
      url: `/api/vote-bosses/${encodedVoteKey}`,
      headers: auth(owner.token),
      payload: { boss: '수동 보스', spawnTime },
    });
    expect(closed.json()).toEqual({ success: true, state: 'INACTIVE' });

    const legacyList = await app.inject({
      method: 'GET',
      url: '/api/vote-bosses',
      headers: auth(owner.token),
    });
    expect(legacyList.json()).toEqual([]);

    const v1List = await app.inject({
      method: 'GET',
      url: '/api/v1/boss-votes',
      headers: auth(owner.token),
    });
    expect(v1List.json()).toMatchObject({
      data: [{ voteKey, isClosed: true, participantCount: 0 }],
    });

    const hardDeleted = await app.inject({
      method: 'DELETE',
      url: `/api/vote-bosses/manual/${manualId}`,
      headers: auth(owner.token),
    });
    expect(hardDeleted.json()).toEqual({ success: true });
    expect(
      app.db.prepare('SELECT 1 FROM manual_boss_votes WHERE id = ?').get(manualId),
    ).toBeUndefined();
  }, 15_000);
});
