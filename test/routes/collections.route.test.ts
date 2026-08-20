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

const collectionPayload = (name = '전설 방어구') => ({
  name,
  items: [
    { part: '발키리 갑옷', enchantment: '강화 7' },
    { part: '발키리 투구', enchantment: '강화 5' },
  ],
});

const createCollection = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  name = '전설 방어구',
) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v2/collections',
    headers: { authorization: `Bearer ${token}` },
    payload: collectionPayload(name),
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { id: number }).id;
};

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('collection definition routes', () => {
  it('allows all members to read but only staff to manage guild-scoped collections', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '아이템 길드', 'collectionowner');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'collectionmember');
    const admin = await joinGuild(app, owner.guildId, 'ADMIN', 'collectionadmin');
    const otherOwner = await createGuild(app, '다른 아이템 길드', 'othercollectionowner');

    const empty = await app.inject({
      method: 'GET',
      url: '/api/v2/collections',
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual([]);

    const denied = await app.inject({
      method: 'POST',
      url: '/api/v2/collections',
      headers: { authorization: `Bearer ${member.token}` },
      payload: collectionPayload(),
    });
    expect(denied.statusCode).toBe(403);

    const collectionId = await createCollection(app, admin.token);
    const list = await app.inject({
      method: 'GET',
      url: '/api/v2/collections',
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(list.json()).toMatchObject([
      {
        id: collectionId,
        name: '전설 방어구',
        items: [
          { id: expect.any(Number), part: '발키리 갑옷', enchantment: '강화 7' },
          { id: expect.any(Number), part: '발키리 투구', enchantment: '강화 5' },
        ],
      },
    ]);

    const oldLegacyList = await app.inject({
      method: 'GET',
      url: '/api/collections',
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(oldLegacyList.statusCode).toBe(200);
    expect(oldLegacyList.json()).toEqual(list.json());

    const v1List = await app.inject({
      method: 'GET',
      url: '/api/v1/collections',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(v1List.json()).toMatchObject({
      data: [{ id: collectionId, items: [{ sortOrder: 0 }, { sortOrder: 1 }] }],
    });

    const isolated = await app.inject({
      method: 'GET',
      url: '/api/v2/collections',
      headers: { authorization: `Bearer ${otherOwner.token}` },
    });
    expect(isolated.json()).toEqual([]);

    const crossGuildDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v2/collections/${collectionId}`,
      headers: { authorization: `Bearer ${otherOwner.token}` },
    });
    expect(crossGuildDelete.statusCode).toBe(404);
  }, 15_000);

  it('preserves supplied item IDs and statuses while reordering, then cascades removed items', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '안정 ID 길드', 'stableidowner');
    const collectionId = await createCollection(app, owner.token);
    const initial = await app.inject({
      method: 'GET',
      url: '/api/v2/collections',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    const initialItems = (initial.json() as Array<{ items: Array<{ id: number }> }>)[0]!.items;
    const firstId = initialItems[0]!.id;
    const secondId = initialItems[1]!.id;

    const completed = await app.inject({
      method: 'POST',
      url: '/api/v2/user-collections/toggle',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { userId: owner.userId, collectionItemId: firstId, completed: true },
    });
    expect(completed.statusCode).toBe(200);

    const completionAuditBeforeItemRemoval = app.db
      .prepare(
        `
          SELECT collection_item_id
          FROM collection_audit_logs
          WHERE action = 'COMPLETION_CHANGED' AND actor_user_id = ?
        `,
      )
      .get(owner.userId) as { collection_item_id: number } | undefined;
    expect(completionAuditBeforeItemRemoval?.collection_item_id).toBe(firstId);

    const update = await app.inject({
      method: 'PUT',
      url: `/api/v1/collections/${collectionId}`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: {
        name: '전설 방어구 개편',
        items: [
          { id: secondId, part: '발키리 투구', enchantment: '강화 6' },
          { id: firstId, part: '발키리 갑옷', enchantment: '강화 8' },
          { part: '발키리 장갑', enchantment: '강화 5' },
        ],
      },
    });
    expect(update.statusCode).toBe(200);
    const updatedItems = (update.json() as { data: { items: Array<{ id: number }> } }).data.items;
    expect(updatedItems.map((item) => item.id).slice(0, 2)).toEqual([secondId, firstId]);
    const newId = updatedItems[2]!.id;

    const preserved = await app.inject({
      method: 'GET',
      url: '/api/v2/user-collections',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(preserved.json()).toEqual([{ user_id: owner.userId, collection_item_id: firstId }]);

    const oldLegacyCompletions = await app.inject({
      method: 'GET',
      url: '/api/user-collections',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(oldLegacyCompletions.json()).toEqual(preserved.json());

    const removeCompletedItem = await app.inject({
      method: 'PUT',
      url: `/api/v2/collections/${collectionId}`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: {
        name: '전설 방어구 개편',
        items: [
          { id: secondId, part: '발키리 투구', enchantment: '강화 6' },
          { id: newId, part: '발키리 장갑', enchantment: '강화 5' },
        ],
      },
    });
    expect(removeCompletedItem.statusCode).toBe(200);

    const cascaded = await app.inject({
      method: 'GET',
      url: '/api/v2/user-collections',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(cascaded.json()).toEqual([]);

    const completionAuditAfterItemRemoval = app.db
      .prepare(
        `
          SELECT 1
          FROM collection_audit_logs
          WHERE action = 'COMPLETION_CHANGED' AND collection_item_id = ?
        `,
      )
      .get(firstId);
    expect(completionAuditAfterItemRemoval).toBeUndefined();
  });
});

describe('collection completion and exclusion routes', () => {
  it('allows self completion and master overrides but rejects admin changes for others', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '보유 상태 길드', 'completionowner');
    const admin = await joinGuild(app, owner.guildId, 'ADMIN', 'completionadmin');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'completionmember');
    const collectionId = await createCollection(app, admin.token);
    const list = await app.inject({
      method: 'GET',
      url: '/api/v2/collections',
      headers: { authorization: `Bearer ${member.token}` },
    });
    const itemId = (list.json() as Array<{ items: Array<{ id: number }> }>)[0]!.items[0]!.id;

    const self = await app.inject({
      method: 'POST',
      url: '/api/v2/user-collections/toggle',
      headers: { authorization: `Bearer ${member.token}` },
      payload: { userId: member.userId, collectionItemId: itemId, completed: true },
    });
    expect(self.statusCode).toBe(200);
    expect(self.json()).toEqual({ status: 'added' });

    const adminDenied = await app.inject({
      method: 'POST',
      url: '/api/v2/user-collections/toggle',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { userId: member.userId, collectionItemId: itemId, completed: false },
    });
    expect(adminDenied.statusCode).toBe(403);

    const masterOverride = await app.inject({
      method: 'PUT',
      url: '/api/v1/collection-completions',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { userId: member.userId, collectionItemId: itemId, completed: false },
    });
    expect(masterOverride.statusCode).toBe(200);
    expect(masterOverride.json()).toEqual({ data: { status: 'removed', completed: false } });

    const completions = await app.inject({
      method: 'GET',
      url: '/api/v1/collection-completions',
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(completions.json()).toEqual({ data: [] });

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/collections/${collectionId}`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(deleted.statusCode).toBe(204);
  });

  it('returns guild-scoped completion logs to the master and 움매 account only', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '체크 로그 길드', 'logowner');
    const admin = await joinGuild(app, owner.guildId, 'ADMIN', 'logadmin');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'logmember');
    const completionLogViewer = await joinGuild(
      app,
      owner.guildId,
      'MEMBER',
      'completionlogviewer',
    );
    app.db
      .prepare('UPDATE users SET username = ? WHERE id = ? AND guild_id = ?')
      .run('움매', completionLogViewer.userId, owner.guildId);
    const otherOwner = await createGuild(app, '다른 체크 로그 길드', 'otherlogowner');

    const collectionId = await createCollection(app, admin.token, '로그 컬렉션');
    const collections = await app.inject({
      method: 'GET',
      url: '/api/v1/collections',
      headers: { authorization: `Bearer ${member.token}` },
    });
    const itemId = (collections.json() as { data: Array<{ items: Array<{ id: number }> }> })
      .data[0]!.items[0]!.id;

    await app.inject({
      method: 'PUT',
      url: '/api/v1/collection-completions',
      headers: { authorization: `Bearer ${completionLogViewer.token}` },
      payload: {
        userId: completionLogViewer.userId,
        collectionItemId: itemId,
        completed: true,
      },
    });
    await app.inject({
      method: 'PUT',
      url: '/api/v1/collection-completions',
      headers: { authorization: `Bearer ${member.token}` },
      payload: { userId: member.userId, collectionItemId: itemId, completed: true },
    });
    await app.inject({
      method: 'PUT',
      url: '/api/v1/collection-completions',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { userId: member.userId, collectionItemId: itemId, completed: false },
    });

    const otherCollectionId = await createCollection(app, otherOwner.token, '다른 로그 컬렉션');
    const otherItem = app.db
      .prepare('SELECT id FROM collection_items WHERE collection_id = ? ORDER BY id LIMIT 1')
      .get(otherCollectionId) as { id: number };
    await app.inject({
      method: 'PUT',
      url: '/api/v1/collection-completions',
      headers: { authorization: `Bearer ${otherOwner.token}` },
      payload: {
        userId: otherOwner.userId,
        collectionItemId: otherItem.id,
        completed: true,
      },
    });

    const memberDenied = await app.inject({
      method: 'GET',
      url: '/api/v1/collection-completion-logs',
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(memberDenied.statusCode).toBe(403);

    const adminDenied = await app.inject({
      method: 'GET',
      url: '/api/v1/collection-completion-logs',
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(adminDenied.statusCode).toBe(403);

    const firstPage = await app.inject({
      method: 'GET',
      url: `/api/v1/collection-completion-logs?limit=1&targetUserId=${member.userId}`,
      headers: { authorization: `Bearer ${completionLogViewer.token}` },
    });
    expect(firstPage.statusCode).toBe(200);
    const firstPageBody = firstPage.json() as {
      data: Array<{
        id: number;
        actorUserId: number;
        actorNickname: string;
        targetUserId: number;
        targetNickname: string;
        collectionId: number;
        collectionName: string;
        collectionItemId: number;
        part: string;
        enchantment: string;
        completed: boolean;
        createdAt: number;
      }>;
      meta: { limit: number; nextCursor: number | null };
    };
    expect(firstPageBody.data).toHaveLength(1);
    expect(firstPageBody.data[0]).toMatchObject({
      actorUserId: owner.userId,
      actorNickname: 'logowner 길드장',
      targetUserId: member.userId,
      targetNickname: 'logmember',
      collectionId,
      collectionName: '로그 컬렉션',
      collectionItemId: itemId,
      part: '발키리 갑옷',
      enchantment: '강화 7',
      completed: false,
    });
    expect(firstPageBody.data[0]!.createdAt).toBeGreaterThan(0);
    expect(firstPageBody.meta).toEqual({
      limit: 1,
      nextCursor: firstPageBody.data[0]!.id,
    });

    const secondPage = await app.inject({
      method: 'GET',
      url: `/api/v1/collection-completion-logs?limit=1&targetUserId=${member.userId}&cursor=${firstPageBody.meta.nextCursor}`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json()).toMatchObject({
      data: [
        {
          actorUserId: member.userId,
          targetUserId: member.userId,
          collectionId,
          collectionItemId: itemId,
          completed: true,
        },
      ],
      meta: { limit: 1, nextCursor: null },
    });

    const crossGuildTarget = await app.inject({
      method: 'GET',
      url: `/api/v1/collection-completion-logs?targetUserId=${otherOwner.userId}`,
      headers: { authorization: `Bearer ${completionLogViewer.token}` },
    });
    expect(crossGuildTarget.statusCode).toBe(200);
    expect(crossGuildTarget.json()).toEqual({
      data: [],
      meta: { limit: 30, nextCursor: null },
    });
  });

  it('lets staff toggle active same-guild priority exclusions and audits mutations', async () => {
    const app = await createApp();
    const owner = await createGuild(app, '제외 관리 길드', 'exclusionowner');
    const admin = await joinGuild(app, owner.guildId, 'ADMIN', 'exclusionadmin');
    const member = await joinGuild(app, owner.guildId, 'MEMBER', 'exclusionmember');
    const otherOwner = await createGuild(app, '타 길드 제외', 'otherexclusionowner');

    const memberDenied = await app.inject({
      method: 'POST',
      url: '/api/excluded-members/toggle',
      headers: { authorization: `Bearer ${member.token}` },
      payload: { userId: member.userId },
    });
    expect(memberDenied.statusCode).toBe(403);

    const added = await app.inject({
      method: 'POST',
      url: '/api/excluded-members/toggle',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { userId: member.userId },
    });
    expect(added.json()).toEqual({ status: 'added' });

    const list = await app.inject({
      method: 'GET',
      url: '/api/excluded-members',
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(list.json()).toEqual([member.userId]);

    const crossGuildTarget = await app.inject({
      method: 'POST',
      url: '/api/excluded-members/toggle',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { userId: otherOwner.userId },
    });
    expect(crossGuildTarget.statusCode).toBe(404);

    const removed = await app.inject({
      method: 'POST',
      url: '/api/v1/collection-exclusions/toggle',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { userId: member.userId },
    });
    expect(removed.json()).toEqual({ data: { status: 'removed' } });

    const audits = app.db
      .prepare('SELECT action FROM collection_audit_logs WHERE guild_id = ? ORDER BY id ASC')
      .all(owner.guildId) as Array<{ action: string }>;
    expect(audits.map((audit) => audit.action)).toEqual(['EXCLUSION_CHANGED', 'EXCLUSION_CHANGED']);
  });
});
