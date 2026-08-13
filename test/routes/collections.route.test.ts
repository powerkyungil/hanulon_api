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
