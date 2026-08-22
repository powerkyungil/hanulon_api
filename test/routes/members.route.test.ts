import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app';
import { createTestConfig } from '../helpers/test-config';

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

const baseProfile = {
  username: 'freya',
  password: 'strong-password',
  nickname: '프레이야',
  occupation: '소서리스',
  main_class: '아크 메이지',
  combat_power: 150000,
  equipment: {
    무기: { val: '발뭉 7강', color: 'legend' },
  },
  skills: {
    active: { '영웅 1': '8강' },
    passive: { '전설 1': 'X' },
  },
};

const createApp = async () => {
  const app = await buildApp(createTestConfig(), { logger: false });
  openApps.push(app);
  return app;
};

const createMasterSession = async (app: Awaited<ReturnType<typeof buildApp>>) => {
  const registerResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { mode: 'CREATE_GUILD', guild_name: '프로필 테스트 길드', ...baseProfile },
  });
  const registration = registerResponse.json() as {
    data: { userId: number; guildId: number };
  };

  const loginResponse = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username: baseProfile.username, password: baseProfile.password },
  });
  const login = loginResponse.json() as { token: string };

  return {
    token: login.token,
    userId: registration.data.userId,
    guildId: registration.data.guildId,
  };
};

const createMemberSession = async (app: Awaited<ReturnType<typeof buildApp>>, guildId: number) => {
  app.db
    .prepare('INSERT INTO invites (guild_id, code, role) VALUES (?, ?, ?)')
    .run(guildId, 'DELETE-ME-MEMBER', 'MEMBER');

  const registerResponse = await app.inject({
    method: 'POST',
    url: '/api/users/register',
    payload: {
      mode: 'JOIN_GUILD',
      code: 'DELETE-ME-MEMBER',
      ...baseProfile,
      username: 'thor',
      nickname: '토르',
    },
  });
  const registration = registerResponse.json() as { userId: number };

  const loginResponse = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username: 'thor', password: baseProfile.password },
  });
  const login = loginResponse.json() as { token: string };

  return { token: login.token, userId: registration.userId };
};

const legacyUpdate = {
  nickname: '프레이야2',
  occupation: '소서리스',
  main_class: '다크 위저드',
  combat_power: 160000,
  equipment: {
    무기: { val: '발뭉 8강', color: 'mythic' },
  },
  skills: {
    active: { '영웅 1': '9강' },
    passive: { '전설 1': '1강' },
  },
  max_crit_rate: 52.3,
  max_crit_resist: 41.2,
  status_effect_acc: 18.0,
  alternate_characters: [{ character_name: '프레이야부캐', main_class: '세인트' }],
  password: 'new-password',
};

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('member profile routes', () => {
  it('returns the current profile on both v1 and Flutter legacy contracts', async () => {
    const app = await createApp();
    const session = await createMasterSession(app);
    const headers = { authorization: `Bearer ${session.token}` };

    const legacyResponse = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers,
    });
    expect(legacyResponse.statusCode).toBe(200);
    expect(legacyResponse.json()).toMatchObject({
      id: session.userId,
      username: 'freya',
      role: 'MASTER',
      nickname: '프레이야',
      occupation: '소서리스',
      main_class: '아크 메이지',
      combat_power: 150000,
      max_crit_rate: 0,
      max_crit_resist: 0,
      status_effect_acc: 0,
      alternate_characters: [],
    });

    const v1Response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers,
    });
    expect(v1Response.statusCode).toBe(200);
    expect(v1Response.json()).toMatchObject({
      data: {
        id: session.userId,
        username: 'freya',
        mainClass: '아크 메이지',
        combatPower: 150000,
        alternateCharacters: [],
      },
    });
  });

  it('updates the profile atomically, stores alternate character data, and changes the password', async () => {
    const app = await createApp();
    const session = await createMasterSession(app);
    const headers = { authorization: `Bearer ${session.token}` };

    const updateResponse = await app.inject({
      method: 'PUT',
      url: '/api/users/me',
      headers,
      payload: legacyUpdate,
    });
    expect(updateResponse.statusCode).toBe(204);

    const profileResponse = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers,
    });
    expect(profileResponse.statusCode).toBe(200);
    expect(profileResponse.json()).toMatchObject({
      nickname: '프레이야2',
      main_class: '다크 위저드',
      combat_power: 160000,
      max_crit_rate: 52.3,
      max_crit_resist: 41.2,
      status_effect_acc: 18,
      alternate_characters: [{ character_name: '프레이야부캐', main_class: '세인트' }],
    });

    const oldPasswordLogin = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'freya', password: 'strong-password' },
    });
    expect(oldPasswordLogin.statusCode).toBe(401);

    const newPasswordLogin = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'freya', password: 'new-password' },
    });
    expect(newPasswordLogin.statusCode).toBe(200);
  });

  it('prevents a member from changing combat power when the guild setting is locked', async () => {
    const app = await createApp();
    const owner = await createMasterSession(app);
    app.db
      .prepare('INSERT INTO invites (guild_id, code, role) VALUES (?, ?, ?)')
      .run(owner.guildId, 'MEMBER-1', 'MEMBER');

    const joinResponse = await app.inject({
      method: 'POST',
      url: '/api/users/register',
      payload: {
        mode: 'JOIN_GUILD',
        code: 'MEMBER-1',
        ...baseProfile,
        username: 'thor',
        nickname: '토르',
      },
    });
    expect(joinResponse.statusCode).toBe(201);

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'thor', password: baseProfile.password },
    });
    const memberToken = (loginResponse.json() as { token: string }).token;
    app.db
      .prepare('UPDATE guild_settings SET allow_member_combat_power_edit = 0 WHERE guild_id = ?')
      .run(owner.guildId);

    const updateResponse = await app.inject({
      method: 'PUT',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { ...legacyUpdate, combat_power: 160001, password: undefined },
    });

    expect(updateResponse.statusCode).toBe(403);
    expect(updateResponse.json()).toMatchObject({
      code: 'COMBAT_POWER_EDIT_FORBIDDEN',
    });
  });

  it('requires authentication and validates class combinations', async () => {
    const app = await createApp();
    const unauthenticated = await app.inject({
      method: 'GET',
      url: '/api/users/me',
    });
    expect(unauthenticated.statusCode).toBe(401);

    const session = await createMasterSession(app);
    const invalidUpdate = await app.inject({
      method: 'PUT',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${session.token}` },
      payload: {
        nickname: '프레이야',
        occupation: '워리어',
        mainClass: '아크 메이지',
        combatPower: 150000,
        equipment: {},
        skills: { active: {}, passive: {} },
        maxCritRate: 0,
        maxCritResist: 0,
        statusEffectAcc: 0,
        alternateCharacters: [],
      },
    });
    expect(invalidUpdate.statusCode).toBe(422);
    expect(invalidUpdate.json()).toMatchObject({
      error: { code: 'INVALID_CLASS_COMBINATION' },
    });
  });

  it('rejects a wrong password and requires master transfer when another guild member exists', async () => {
    const app = await createApp();
    const master = await createMasterSession(app);
    const headers = { authorization: `Bearer ${master.token}` };

    const unauthenticated = await app.inject({
      method: 'DELETE',
      url: '/api/users/me',
      payload: { password: baseProfile.password },
    });
    expect(unauthenticated.statusCode).toBe(401);

    const missingPassword = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/me',
      headers,
      payload: {},
    });
    expect(missingPassword.statusCode).toBe(400);

    const wrongPassword = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/me',
      headers,
      payload: { password: 'wrong-password' },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(wrongPassword.json()).toMatchObject({
      error: { code: 'ACCOUNT_DELETE_PASSWORD_INVALID' },
    });

    await createMemberSession(app, master.guildId);

    const masterDeletion = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/me',
      headers,
      payload: { password: baseProfile.password },
    });
    expect(masterDeletion.statusCode).toBe(409);
    expect(masterDeletion.json()).toMatchObject({
      error: { code: 'MASTER_ACCOUNT_DELETE_FORBIDDEN' },
    });
    expect(
      app.db.prepare('SELECT COUNT(*) AS count FROM users WHERE id = ?').get(master.userId),
    ).toEqual({ count: 1 });
    expect(
      app.db.prepare('SELECT COUNT(*) AS count FROM guilds WHERE id = ?').get(master.guildId),
    ).toEqual({ count: 1 });
  });

  it('deletes a sole master together with the entire guild without affecting another guild', async () => {
    const app = await createApp();
    const master = await createMasterSession(app);
    const otherGuildResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        mode: 'CREATE_GUILD',
        guild_name: '보존 대상 길드',
        ...baseProfile,
        username: 'loki',
        nickname: '로키',
      },
    });
    const otherGuild = otherGuildResponse.json() as {
      data: { userId: number; guildId: number };
    };

    for (const [guildId, userId, suffix] of [
      [master.guildId, master.userId, '삭제'],
      [otherGuild.data.guildId, otherGuild.data.userId, '보존'],
    ] as const) {
      app.db
        .prepare(
          'INSERT INTO notice_rules (guild_id, title, content, created_by) VALUES (?, ?, ?, ?)',
        )
        .run(guildId, `${suffix} 규칙`, `${suffix} 공유 데이터`, userId);
      app.db
        .prepare(
          "INSERT INTO guild_audit_logs (guild_id, actor_user_id, action, metadata_json) VALUES (?, ?, 'SETTINGS_UPDATED', ?)",
        )
        .run(guildId, userId, JSON.stringify({ guild: suffix }));
      app.db
        .prepare(
          "INSERT INTO schedule_history (guild_id, type, region, boss, spawn_time, is_mung, created_by) VALUES (?, '월드', '미드가르드', ?, ?, 0, ?)",
        )
        .run(guildId, `${suffix} 보스`, guildId * 1000, userId);
    }

    const deletion = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${master.token}` },
      payload: { password: baseProfile.password },
    });
    expect(deletion.statusCode).toBe(204);

    expect(
      app.db.prepare('SELECT COUNT(*) AS count FROM guilds WHERE id = ?').get(master.guildId),
    ).toEqual({ count: 0 });
    const allTables = app.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    const guildScopedTables = allTables.filter(({ name }) =>
      (
        app.db.prepare(`PRAGMA table_info("${String(name)}")`).all() as Array<{ name: string }>
      ).some((column) => column.name === 'guild_id'),
    );
    for (const { name } of guildScopedTables) {
      expect(
        app.db
          .prepare(`SELECT COUNT(*) AS count FROM "${name}" WHERE guild_id = ?`)
          .get(master.guildId),
      ).toEqual({ count: 0 });
    }

    expect(
      app.db
        .prepare('SELECT COUNT(*) AS count FROM guilds WHERE id = ?')
        .get(otherGuild.data.guildId),
    ).toEqual({ count: 1 });
    expect(
      app.db
        .prepare('SELECT COUNT(*) AS count FROM users WHERE id = ?')
        .get(otherGuild.data.userId),
    ).toEqual({ count: 1 });
    for (const table of ['notice_rules', 'guild_audit_logs', 'schedule_history']) {
      expect(
        app.db
          .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE guild_id = ?`)
          .get(otherGuild.data.guildId),
      ).toEqual({ count: 1 });
    }

    const oldTokenResponse = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${master.token}` },
    });
    expect(oldTokenResponse.statusCode).toBe(401);
  });

  it('hard-deletes only the current member data and invalidates the existing token', async () => {
    const app = await createApp();
    const master = await createMasterSession(app);
    const member = await createMemberSession(app, master.guildId);

    app.db
      .prepare(
        'INSERT INTO alternate_characters (user_id, character_name, main_class) VALUES (?, ?, ?)',
      )
      .run(member.userId, '토르부캐', '세인트');
    const collectionId = Number(
      app.db
        .prepare('INSERT INTO collections (guild_id, name) VALUES (?, ?)')
        .run(master.guildId, '공유 컬렉션').lastInsertRowid,
    );
    const itemId = Number(
      app.db
        .prepare('INSERT INTO collection_items (collection_id, part, enchantment) VALUES (?, ?, ?)')
        .run(collectionId, '무기', '7강').lastInsertRowid,
    );
    app.db
      .prepare(
        'INSERT INTO user_collection_items (guild_id, user_id, collection_item_id) VALUES (?, ?, ?)',
      )
      .run(master.guildId, member.userId, itemId);
    app.db
      .prepare('INSERT INTO excluded_members (guild_id, user_id) VALUES (?, ?)')
      .run(master.guildId, member.userId);
    const groupId = Number(
      app.db
        .prepare('INSERT INTO content_groups (guild_id, name) VALUES (?, ?)')
        .run(master.guildId, '공유 그룹').lastInsertRowid,
    );
    app.db
      .prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)')
      .run(groupId, member.userId);
    app.db
      .prepare(
        'INSERT INTO siege_records (guild_id, user_id, current_diamonds, remaining_diamonds, updated_by) VALUES (?, ?, ?, ?, ?)',
      )
      .run(master.guildId, member.userId, 100, 50, member.userId);
    app.db
      .prepare(
        'INSERT INTO boss_participants (guild_id, vote_key, boss, spawn_time, user_id, nickname_snapshot) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(master.guildId, 'delete-me-vote', '월드보스', 1_800_000_000_000, member.userId, '토르');

    const masterRequestId = Number(
      app.db
        .prepare(
          'INSERT INTO support_requests (guild_id, requester_id, requested_time) VALUES (?, ?, ?)',
        )
        .run(master.guildId, master.userId, '21:00').lastInsertRowid,
    );
    const selectedApplicationId = Number(
      app.db
        .prepare(
          "INSERT INTO support_applications (request_id, applicant_id, status) VALUES (?, ?, 'SELECTED')",
        )
        .run(masterRequestId, member.userId).lastInsertRowid,
    );
    app.db
      .prepare(
        "UPDATE support_requests SET status = 'MATCHED', selected_application_id = ? WHERE id = ?",
      )
      .run(selectedApplicationId, masterRequestId);
    const memberRequestId = Number(
      app.db
        .prepare(
          'INSERT INTO support_requests (guild_id, requester_id, requested_time) VALUES (?, ?, ?)',
        )
        .run(master.guildId, member.userId, '22:00').lastInsertRowid,
    );

    app.db
      .prepare(
        "INSERT INTO notice_rules (guild_id, title, content, created_by) VALUES (?, '규칙', '공유 본문', ?)",
      )
      .run(master.guildId, member.userId);
    app.db
      .prepare(
        "INSERT INTO price_guides (guild_id, title, content, created_by) VALUES (?, '시세', '공유 본문', ?)",
      )
      .run(master.guildId, member.userId);
    app.db
      .prepare(
        "INSERT INTO boss_controls (guild_id, chapter, boss, status, updated_by) VALUES (?, '1장', '보스', 'CONTROL', ?)",
      )
      .run(master.guildId, member.userId);
    app.db
      .prepare(
        'INSERT INTO siege_records (guild_id, user_id, current_diamonds, remaining_diamonds, updated_by) VALUES (?, ?, ?, ?, ?)',
      )
      .run(master.guildId, master.userId, 200, 100, member.userId);
    const bossDefinitionId = Number(
      app.db
        .prepare(
          "INSERT INTO boss_definitions (guild_id, type, region, boss) VALUES (?, '월드', '미드가르드', '공유보스')",
        )
        .run(master.guildId).lastInsertRowid,
    );
    app.db
      .prepare(
        'INSERT INTO boss_schedules (guild_id, boss_definition_id, spawn_time, created_by) VALUES (?, ?, ?, ?)',
      )
      .run(master.guildId, bossDefinitionId, 1_800_000_100_000, member.userId);
    app.db
      .prepare(
        "INSERT INTO participation_states (guild_id, vote_key, spawn_time, state, updated_by) VALUES (?, 'shared-state', ?, 'INACTIVE', ?)",
      )
      .run(master.guildId, 1_800_000_200_000, member.userId);
    app.db
      .prepare(
        "INSERT INTO manual_boss_votes (guild_id, type, region, boss, spawn_time, created_by) VALUES (?, '월드', '요툰하임', '공유투표', ?, ?)",
      )
      .run(master.guildId, 1_800_000_300_000, member.userId);

    const personalAuditFixtures = [
      [
        'member_audit_logs',
        'guild_id, actor_user_id, target_user_id, action, metadata_json',
        [
          master.guildId,
          master.userId,
          member.userId,
          'MEMBER_REMOVED',
          '{"targetNickname":"토르"}',
        ],
      ],
      [
        'guild_audit_logs',
        'guild_id, actor_user_id, action, metadata_json',
        [master.guildId, member.userId, 'SETTINGS_UPDATED', '{}'],
      ],
      [
        'notice_audit_logs',
        'guild_id, actor_user_id, action, metadata_json',
        [master.guildId, member.userId, 'ARTICLE_UPDATED', '{"ip":"203.0.113.77"}'],
      ],
      [
        'support_audit_logs',
        'guild_id, actor_user_id, request_id, action, metadata_json',
        [master.guildId, master.userId, memberRequestId, 'REQUEST_STATUS_CHANGED', '{}'],
      ],
      [
        'support_audit_logs',
        'guild_id, actor_user_id, request_id, action, metadata_json',
        [
          master.guildId,
          master.userId,
          masterRequestId,
          'APPLICATION_SELECTED',
          JSON.stringify({ applicationId: selectedApplicationId }),
        ],
      ],
      [
        'collection_audit_logs',
        'guild_id, actor_user_id, collection_item_id, action, metadata_json',
        [
          master.guildId,
          master.userId,
          itemId,
          'COMPLETION_CHANGED',
          JSON.stringify({ userId: member.userId, collectionItemId: itemId, completed: true }),
        ],
      ],
      [
        'content_group_audit_logs',
        'guild_id, actor_user_id, group_id, action, metadata_json',
        [
          master.guildId,
          master.userId,
          groupId,
          'MEMBERS_REPLACED',
          JSON.stringify({ previousMemberIds: [member.userId], nextMemberIds: [master.userId] }),
        ],
      ],
      [
        'siege_audit_logs',
        'guild_id, actor_user_id, target_user_id, action, metadata_json',
        [master.guildId, master.userId, member.userId, 'RECORD_UPDATED', '{}'],
      ],
      [
        'boss_audit_logs',
        'guild_id, actor_user_id, boss_definition_id, action, metadata_json',
        [master.guildId, member.userId, bossDefinitionId, 'BOSS_CREATED', '{}'],
      ],
      [
        'schedule_audit_logs',
        'guild_id, actor_user_id, schedule_id, action, metadata_json',
        [master.guildId, member.userId, null, 'SCHEDULES_SAVED', '{}'],
      ],
      [
        'boss_vote_audit_logs',
        'guild_id, actor_user_id, vote_key, action, metadata_json',
        [
          master.guildId,
          master.userId,
          'delete-me-vote',
          'PARTICIPANT_REMOVED',
          JSON.stringify({ userId: member.userId }),
        ],
      ],
    ] as const;
    for (const [table, columns, values] of personalAuditFixtures) {
      const placeholders = values.map(() => '?').join(', ');
      app.db.prepare(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})`).run(...values);
    }
    app.db
      .prepare(
        "INSERT INTO boss_audit_logs (guild_id, actor_user_id, action, metadata_json) VALUES (?, ?, 'BOSSES_RESET', ?)",
      )
      .run(
        master.guildId,
        master.userId,
        JSON.stringify({ formerUsername: 'thor', formerNickname: '토르' }),
      );
    app.db
      .prepare(
        "INSERT INTO guild_audit_logs (guild_id, actor_user_id, action, metadata_json) VALUES (?, ?, 'SETTINGS_UPDATED', '{}')",
      )
      .run(master.guildId, master.userId);

    const deletion = await app.inject({
      method: 'DELETE',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${member.token}` },
      payload: { password: baseProfile.password },
    });
    expect(deletion.statusCode).toBe(204);

    const personalTables = [
      ['users', 'id'],
      ['characters', 'user_id'],
      ['alternate_characters', 'user_id'],
      ['support_applications', 'applicant_id'],
      ['support_requests', 'requester_id'],
      ['user_collection_items', 'user_id'],
      ['excluded_members', 'user_id'],
      ['group_members', 'user_id'],
      ['siege_records', 'user_id'],
      ['boss_participants', 'user_id'],
    ] as const;
    for (const [table, column] of personalTables) {
      expect(
        app.db
          .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`)
          .get(member.userId),
      ).toEqual({ count: 0 });
    }
    expect(
      app.db
        .prepare('SELECT COUNT(*) AS count FROM support_requests WHERE id = ?')
        .get(memberRequestId),
    ).toEqual({ count: 0 });
    expect(
      app.db
        .prepare('SELECT status, selected_application_id FROM support_requests WHERE id = ?')
        .get(masterRequestId),
    ).toEqual({ status: 'OPEN', selected_application_id: null });

    expect(
      app.db.prepare('SELECT COUNT(*) AS count FROM users WHERE id = ?').get(master.userId),
    ).toEqual({ count: 1 });
    expect(
      app.db.prepare('SELECT COUNT(*) AS count FROM guilds WHERE id = ?').get(master.guildId),
    ).toEqual({ count: 1 });
    expect(
      app.db.prepare('SELECT COUNT(*) AS count FROM collections WHERE id = ?').get(collectionId),
    ).toEqual({ count: 1 });
    expect(
      app.db.prepare('SELECT COUNT(*) AS count FROM content_groups WHERE id = ?').get(groupId),
    ).toEqual({ count: 1 });

    const anonymizedAttributionChecks = [
      ['notice_rules', 'created_by'],
      ['price_guides', 'created_by'],
      ['boss_controls', 'updated_by'],
      ['siege_records', 'updated_by'],
      ['boss_schedules', 'created_by'],
      ['schedule_history', 'created_by'],
      ['participation_states', 'updated_by'],
      ['manual_boss_votes', 'created_by'],
    ] as const;
    for (const [table, column] of anonymizedAttributionChecks) {
      expect(
        app.db
          .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`)
          .get(member.userId),
      ).toEqual({ count: 0 });
      expect(
        app.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = 0`).get(),
      ).toEqual({ count: 1 });
    }

    const auditReferenceChecks = [
      ['member_audit_logs', 'actor_user_id = ? OR target_user_id = ?'],
      ['guild_audit_logs', 'actor_user_id = ?'],
      ['notice_audit_logs', 'actor_user_id = ?'],
      ['support_audit_logs', 'actor_user_id = ?'],
      ['collection_audit_logs', 'actor_user_id = ?'],
      ['content_group_audit_logs', 'actor_user_id = ?'],
      ['siege_audit_logs', 'actor_user_id = ? OR target_user_id = ?'],
      ['boss_audit_logs', 'actor_user_id = ?'],
      ['schedule_audit_logs', 'actor_user_id = ?'],
      ['boss_vote_audit_logs', 'actor_user_id = ?'],
    ] as const;
    for (const [table, condition] of auditReferenceChecks) {
      const params = condition.includes('OR') ? [member.userId, member.userId] : [member.userId];
      expect(
        app.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${condition}`).get(...params),
      ).toEqual({ count: 0 });
    }
    const fullyRemovedPersonalAuditTables = [
      'member_audit_logs',
      'notice_audit_logs',
      'support_audit_logs',
      'collection_audit_logs',
      'content_group_audit_logs',
      'siege_audit_logs',
      'boss_audit_logs',
      'schedule_audit_logs',
      'boss_vote_audit_logs',
    ];
    for (const table of fullyRemovedPersonalAuditTables) {
      expect(app.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
    expect(app.db.prepare('SELECT COUNT(*) AS count FROM guild_audit_logs').get()).toEqual({
      count: 1,
    });

    const personalTextValues = ['thor', '토르', '203.0.113.77'];
    const tables = app.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    for (const { name } of tables) {
      const textColumns = (
        app.db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{
          name: string;
          type: string;
        }>
      ).filter((column) => column.type.toUpperCase().includes('TEXT'));
      for (const column of textColumns) {
        for (const personalValue of personalTextValues) {
          expect(
            app.db
              .prepare(
                `SELECT COUNT(*) AS count FROM "${name}" WHERE instr("${column.name}", ?) > 0`,
              )
              .get(personalValue),
          ).toEqual({ count: 0 });
        }
      }
    }

    const oldTokenResponse = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(oldTokenResponse.statusCode).toBe(401);

    const oldCredentialsResponse = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'thor', password: baseProfile.password },
    });
    expect(oldCredentialsResponse.statusCode).toBe(401);
  });
});
