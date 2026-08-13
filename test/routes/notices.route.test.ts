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
    .prepare('INSERT INTO invites (guild_id, code, role) VALUES (?, ?, ?)')
    .run(guildId, code, role);
  const response = await app.inject({
    method: 'POST',
    url: '/api/users/register',
    payload: { mode: 'JOIN_GUILD', code, ...profileFor(username, username) },
  });
  expect(response.statusCode).toBe(201);
  return { token: await login(app, username) };
};

const articleInput = (title: string) => ({
  title,
  content: `${title} > 안내 > 내용을 확인해 주세요.`,
  color: '#F2B705',
});

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('notice article routes', () => {
  it('allows every active member to read notices but only managers can create them', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '공지 권한 길드', 'noticeowner');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'noticemember');

    const read = await app.inject({
      method: 'GET',
      url: '/api/notices/rules',
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual([]);

    const denied = await app.inject({
      method: 'POST',
      url: '/api/notices/rules',
      headers: { authorization: `Bearer ${member.token}` },
      payload: articleInput('권한 없는 공지'),
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('supports legacy and v1 CRUD while isolating every guild', async () => {
    const app = await createApp();
    const firstOwner = await createGuild(app, '첫 공지 길드', 'firstnoticeowner');
    const secondOwner = await createGuild(app, '둘째 공지 길드', 'secondnoticeowner');
    const admin = await joinGuild(app, firstOwner.guildId, 'ADMIN', 'noticeadmin');

    const created = await app.inject({
      method: 'POST',
      url: '/api/notices/rules',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: articleInput('길드 운영 내규'),
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ success: true, id: expect.any(Number) });
    const articleId = (created.json() as { id: number }).id;

    const firstGuildList = await app.inject({
      method: 'GET',
      url: '/api/v1/notices/rules',
      headers: { authorization: `Bearer ${firstOwner.token}` },
    });
    expect(firstGuildList.statusCode).toBe(200);
    expect(firstGuildList.json()).toMatchObject({
      data: [{ id: articleId, title: '길드 운영 내규', sortOrder: 0 }],
    });

    const secondGuildList = await app.inject({
      method: 'GET',
      url: '/api/notices/rules',
      headers: { authorization: `Bearer ${secondOwner.token}` },
    });
    expect(secondGuildList.json()).toEqual([]);

    const crossGuildUpdate = await app.inject({
      method: 'PUT',
      url: `/api/notices/rules/${articleId}`,
      headers: { authorization: `Bearer ${secondOwner.token}` },
      payload: articleInput('다른 길드의 변경'),
    });
    expect(crossGuildUpdate.statusCode).toBe(404);

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/v1/notices/rules/${articleId}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { ...articleInput('수정된 내규'), color: '#3B82F6' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      data: { id: articleId, title: '수정된 내규', color: '#3B82F6' },
    });

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/notices/rules/${articleId}`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(deleted.statusCode).toBe(204);

    const audits = app.db
      .prepare('SELECT action FROM notice_audit_logs WHERE guild_id = ? ORDER BY id ASC')
      .all(firstOwner.guildId) as Array<{ action: string }>;
    expect(audits.map((audit) => audit.action)).toEqual([
      'ARTICLE_CREATED',
      'ARTICLE_UPDATED',
      'ARTICLE_DELETED',
    ]);
  });

  it('stores price guides and validates the complete guild rule order', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '공지 순서 길드', 'orderowner');

    const ids: number[] = [];
    for (const title of ['첫 번째', '두 번째', '세 번째']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/notices/rules',
        headers: { authorization: `Bearer ${owner.token}` },
        payload: articleInput(title),
      });
      ids.push((response.json() as { id: number }).id);
    }

    const invalidOrder = await app.inject({
      method: 'PUT',
      url: '/api/notices/rule-order',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { ids: [ids[2], ids[0]] },
    });
    expect(invalidOrder.statusCode).toBe(422);
    expect(invalidOrder.json()).toMatchObject({ code: 'NOTICE_RULE_ORDER_INVALID' });

    const reorderedIds = [ids[2], ids[0], ids[1]];
    const reordered = await app.inject({
      method: 'PUT',
      url: '/api/v1/notices/rules/order',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { ids: reorderedIds },
    });
    expect(reordered.statusCode).toBe(204);

    const list = await app.inject({
      method: 'GET',
      url: '/api/notices/rules',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect((list.json() as Array<{ id: number }>).map((article) => article.id)).toEqual(
      reorderedIds,
    );

    const priceGuide = await app.inject({
      method: 'POST',
      url: '/api/v1/notices/price-guides',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: articleInput('전설 아이템 가격표'),
    });
    expect(priceGuide.statusCode).toBe(201);
    expect(priceGuide.json()).toMatchObject({ data: { title: '전설 아이템 가격표' } });
  });
});

describe('boss control routes', () => {
  it('returns the fixed catalog and lets master or admin update a valid boss only', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '보스 통제 길드', 'bosscontrolowner');
    const admin = await joinGuild(app, owner.guildId, 'ADMIN', 'bosscontroladmin');

    const initial = await app.inject({
      method: 'GET',
      url: '/api/notices/boss-controls',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(initial.statusCode).toBe(200);
    const initialChapters = (
      initial.json() as {
        chapters: Array<{ chapter: string; bosses: Array<{ name: string; status: string }> }>;
      }
    ).chapters;
    expect(initialChapters).toHaveLength(12);
    expect(initialChapters[0]?.chapter).toBe('요툰하임');
    expect(initialChapters[0]?.bosses[0]).toEqual({ name: '파르바', status: 'NONE' });

    const update = await app.inject({
      method: 'PUT',
      url: '/api/notices/boss-controls',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { chapter: '요툰하임', boss: '파르바', status: 'CONTROL' },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toEqual({ success: true });

    const refreshed = await app.inject({
      method: 'GET',
      url: '/api/v1/notices/boss-controls',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    const chapters = (
      refreshed.json() as {
        data: {
          chapters: Array<{ chapter: string; bosses: Array<{ name: string; status: string }> }>;
        };
      }
    ).data.chapters;
    expect(chapters[0]?.bosses[0]).toEqual({ name: '파르바', status: 'CONTROL' });

    const invalidTarget = await app.inject({
      method: 'PUT',
      url: '/api/v1/notices/boss-controls',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { chapter: '요툰하임', boss: '없는 보스', status: 'ALLY_ONLY' },
    });
    expect(invalidTarget.statusCode).toBe(422);
    expect(invalidTarget.json()).toMatchObject({
      error: { code: 'BOSS_CONTROL_TARGET_INVALID' },
    });
  });
});
