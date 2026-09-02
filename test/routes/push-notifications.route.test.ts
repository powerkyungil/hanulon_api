import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app';
import { PushNotificationsRepository } from '../../src/modules/push-notifications/push-notifications.repository';
import { BossPushDispatchService } from '../../src/modules/push-notifications/push-notifications.service';
import type {
  PushMessage,
  PushSender,
} from '../../src/modules/push-notifications/push-notifications.types';
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
    payload: { mode: 'CREATE_GUILD', guild_name: guildName, ...profileFor(username, username) },
  });
  const data = (response.json() as { data: { userId: number; guildId: number } }).data;
  return { ...data, token: await login(app, username) };
};

const joinGuild = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  guildId: number,
  username: string,
) => {
  const code = `PUSH-${username}`.toUpperCase();
  app.db
    .prepare(
      `
        INSERT INTO invites (guild_id, code, role) VALUES (?, ?, ?)
        ON CONFLICT(guild_id, role) DO UPDATE SET code = excluded.code
      `,
    )
    .run(guildId, code, 'MEMBER');
  const response = await app.inject({
    method: 'POST',
    url: '/api/users/register',
    payload: { mode: 'JOIN_GUILD', code, ...profileFor(username, username) },
  });
  expect(response.statusCode).toBe(201);
  return {
    userId: (response.json() as { userId: number }).userId,
    token: await login(app, username),
  };
};

const registerToken = (
  app: Awaited<ReturnType<typeof buildApp>>,
  accessToken: string,
  token: string,
  deviceId: string,
) =>
  app.inject({
    method: 'PUT',
    url: '/api/v1/push-tokens',
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { token, platform: 'ANDROID', deviceId },
  });

class RecordingSender implements PushSender {
  public readonly messages: PushMessage[] = [];

  public async send(message: PushMessage) {
    this.messages.push(message);
    return { messageId: `message-${this.messages.length}` };
  }
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('push notification routes and dispatch', () => {
  it('registers, refreshes, transfers, and deletes Android FCM tokens for authenticated users', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '푸시 토큰 길드', 'pushowner');
    const member = await joinGuild(app, owner.guildId, 'pushmember');
    const firstToken = 'fcm-token-owner-first-00000001';
    const refreshedToken = 'fcm-token-owner-refreshed-0002';

    const unauthorized = await app.inject({
      method: 'PUT',
      url: '/api/v1/push-tokens',
      payload: { token: firstToken, platform: 'ANDROID', deviceId: 'owner-phone' },
    });
    expect(unauthorized.statusCode).toBe(401);

    const registered = await registerToken(app, owner.token, firstToken, 'owner-phone');
    expect(registered.statusCode).toBe(200);
    expect(registered.json()).toMatchObject({
      data: { id: expect.any(Number), platform: 'ANDROID', deviceId: 'owner-phone' },
    });

    const refreshed = await registerToken(app, owner.token, refreshedToken, 'owner-phone');
    expect(refreshed.statusCode).toBe(200);
    expect((refreshed.json() as { data: { id: number } }).data.id).toBe(
      (registered.json() as { data: { id: number } }).data.id,
    );
    expect(app.db.prepare('SELECT COUNT(*) AS count FROM push_device_tokens').get()).toEqual({
      count: 1,
    });

    expect(
      (await registerToken(app, member.token, refreshedToken, 'member-phone')).statusCode,
    ).toBe(200);
    expect(
      app.db
        .prepare('SELECT user_id, device_id FROM push_device_tokens WHERE token = ?')
        .get(refreshedToken),
    ).toEqual({ user_id: member.userId, device_id: 'member-phone' });

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/v1/push-tokens',
      headers: { authorization: `Bearer ${member.token}` },
      payload: { token: refreshedToken },
    });
    expect(deleted.statusCode).toBe(204);
    expect(app.db.prepare('SELECT COUNT(*) AS count FROM push_device_tokens').get()).toEqual({
      count: 0,
    });
  }, 15_000);

  it('sends 5-minute, 1-minute, and spawn notifications once per device and guild', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '보스 푸시 길드', 'bosspushowner');
    const member = await joinGuild(app, owner.guildId, 'bosspushmember');
    const other = await createGuild(app, '다른 푸시 길드', 'otherpushowner');
    await registerToken(app, owner.token, 'fcm-token-owner-0000000000001', 'owner-phone');
    await registerToken(app, member.token, 'fcm-token-member-000000000001', 'member-phone');
    await registerToken(app, other.token, 'fcm-token-other-0000000000002', 'other-phone');

    const definition = app.db
      .prepare(
        `
          INSERT INTO boss_definitions (guild_id, type, region, boss, cooldown_hours)
          VALUES (?, '본섭', '미드가르드', '파르바', 8)
        `,
      )
      .run(owner.guildId);
    const bossDefinitionId = Number(definition.lastInsertRowid);
    const baseNow = 2_000_000_000_000;
    const spawnTime = baseNow + 300_000;
    app.db
      .prepare(
        `
          INSERT INTO boss_schedules (guild_id, boss_definition_id, spawn_time, created_by)
          VALUES (?, ?, ?, ?)
        `,
      )
      .run(owner.guildId, bossDefinitionId, spawnTime, owner.userId);

    const sender = new RecordingSender();
    const service = new BossPushDispatchService(
      new PushNotificationsRepository(app.db),
      sender,
      90_000,
    );

    expect(await service.run(baseNow)).toMatchObject({ sent: 2, skipped: 0 });
    expect(await service.run(baseNow)).toMatchObject({ sent: 0, skipped: 2 });
    await registerToken(app, owner.token, 'fcm-token-owner-refreshed-after-send', 'owner-phone');
    expect(await service.run(baseNow)).toMatchObject({ sent: 0, skipped: 2 });
    expect(await service.run(spawnTime - 60_000)).toMatchObject({ sent: 2 });
    expect(await service.run(spawnTime)).toMatchObject({ sent: 2 });

    expect(sender.messages).toHaveLength(6);
    expect(sender.messages[0]).toMatchObject({
      title: '파르바 출현 5분 전',
      body: '[본섭] 파르바 5분 후 출현합니다.',
      data: { type: 'BOSS_SCHEDULE', leadSeconds: '300', spawnTime: String(spawnTime) },
    });
    expect(sender.messages.at(-1)).toMatchObject({
      title: '파르바 출현',
      body: '[본섭] 파르바 출현 시간입니다.',
    });
    expect(
      app.db
        .prepare("SELECT COUNT(*) AS count FROM push_delivery_history WHERE status = 'SENT'")
        .get(),
    ).toEqual({ count: 6 });
  }, 15_000);

  it('calculates fixed boss occurrences using Asia/Seoul weekdays and time', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '고정 보스 푸시 길드', 'fixedpushowner');
    await registerToken(app, owner.token, 'fcm-token-fixed-owner-00000001', 'fixed-phone');
    const spawnTime = 2_000_100_000_000;
    const seoul = new Date(spawnTime + 9 * 60 * 60 * 1000);
    const pad = (value: number) => String(value).padStart(2, '0');
    const timeText = `${pad(seoul.getUTCHours())}:${pad(seoul.getUTCMinutes())}:${pad(seoul.getUTCSeconds())}`;
    const day = ['일', '월', '화', '수', '목', '금', '토'][seoul.getUTCDay()];
    app.db
      .prepare(
        `
          INSERT INTO boss_definitions (
            guild_id, type, region, boss, cooldown_hours, time_text, days
          ) VALUES (?, '고정', '요툰하임', '고정 파르바', 0, ?, ?)
        `,
      )
      .run(owner.guildId, timeText, day);

    const sender = new RecordingSender();
    const service = new BossPushDispatchService(
      new PushNotificationsRepository(app.db),
      sender,
      90_000,
    );
    expect(await service.run(spawnTime - 300_000)).toMatchObject({ sent: 1 });
    expect(sender.messages).toEqual([
      expect.objectContaining({
        title: '고정 파르바 출현 5분 전',
        body: '[고정] 고정 파르바 5분 후 출현합니다.',
        data: expect.objectContaining({ scheduleId: '', spawnTime: String(spawnTime) }),
      }),
    ]);
  }, 15_000);
});
