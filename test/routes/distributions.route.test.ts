import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app';
import { createTestConfig } from '../helpers/test-config';

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

const createApp = async () => {
  const app = await buildApp(createTestConfig(), { logger: false });
  openApps.push(app);
  return app;
};

const profileFor = (username: string, nickname: string, mainClass = '세인트') => ({
  username,
  password: 'strong-password',
  nickname,
  occupation: mainClass === '아크 메이지' ? '소서리스' : '프리스트',
  main_class: mainClass,
  combat_power: 120000,
  equipment: {},
  skills: { active: {}, passive: {} },
});

const login = async (app: Awaited<ReturnType<typeof buildApp>>, username: string) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username, password: 'strong-password' },
  });
  return (response.json() as { token: string }).token;
};

const createGuild = async (app: Awaited<ReturnType<typeof buildApp>>, username: string) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      mode: 'CREATE_GUILD',
      guild_name: `${username} 길드`,
      ...profileFor(username, `${username} 길드장`),
    },
  });
  expect(response.statusCode).toBe(201);
  const data = (response.json() as { data: { userId: number; guildId: number } }).data;
  return { ...data, token: await login(app, username) };
};

const joinGuild = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  guildId: number,
  role: 'ADMIN' | 'MEMBER',
  username: string,
) => {
  const code = `${role === 'ADMIN' ? 'A' : 'M'}${guildId}${username.slice(-8)}`.toUpperCase();
  app.db
    .prepare(
      `INSERT INTO invites (guild_id, code, role) VALUES (?, ?, ?)
       ON CONFLICT(guild_id, role) DO UPDATE SET code = excluded.code`,
    )
    .run(guildId, code, role);
  const response = await app.inject({
    method: 'POST',
    url: '/api/users/register',
    payload: { mode: 'JOIN_GUILD', code, ...profileFor(username, username, '아크 메이지') },
  });
  expect(response.statusCode).toBe(201);
  return {
    userId: (response.json() as { userId: number }).userId,
    token: await login(app, username),
  };
};

const createDistribution = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  totalFund: string | number = '1000',
  roundingMode: 'NONE' | 'ROUND' | 'CEIL' | 'FLOOR' = 'ROUND',
) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/distributions',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      title: '2026년 8월 1회차',
      startDate: '2026-08-01',
      endDate: '2026-08-07',
      totalFund,
      roundingMode,
    },
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { data: DistributionResponse }).data;
};

interface DistributionResponse {
  id: number;
  status: 'DRAFT' | 'CONFIRMED';
  title: string;
  startDate: string;
  endDate: string;
  roundingMode: 'NONE' | 'ROUND' | 'CEIL' | 'FLOOR';
  confirmedAt: number | null;
  members: Array<{
    id: number;
    userId: number;
    nickname: string;
    mainClass: string | null;
    combatPower: number | null;
    participationRate: string | null;
    allianceRate: string;
    finalDiamonds: string;
    payableDiamonds: string;
    roundingAdjustment: string;
  }>;
  totals: {
    finalDiamonds: string;
    payableDiamonds: string;
    roundingDifference: string;
    supportTotal: string;
    fundingTotalCash: string;
    baseFundCash: string;
    supportTotalCash: string;
  };
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('distribution routes', () => {
  it('stores spreadsheet funding inputs and derives diamond and cash summaries', async () => {
    const app = await createApp();
    const master = await createGuild(app, 'distributionfundingmaster');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/distributions',
      headers: { authorization: `Bearer ${master.token}` },
      payload: {
        title: '엑셀 재원 입력', startDate: '2026-08-01', endDate: '2026-08-07',
        totalFund: '0', cashRate: '4.5', siegeDiamonds: '501726', guildCash: '0',
        scrollCraftDiamonds: '55400', instantReviveDiamonds: '0',
      },
    });
    expect(response.statusCode).toBe(201);
    expect((response.json() as { data: DistributionResponse & Record<string, string> }).data).toMatchObject({
      totalFund: '557126', siegeDiamonds: '501726', guildCash: '0',
      scrollCraftDiamonds: '55400', instantReviveDiamonds: '0',
      totals: {
        supportTotal: '0', fundingTotalCash: '2507067', baseFundCash: '2507067',
        supportTotalCash: '0',
      },
    });
    const id = (response.json() as { data: DistributionResponse }).data.id;
    const rounded = await app.inject({
      method: 'PATCH', url: `/api/v1/distributions/${id}`,
      headers: { authorization: `Bearer ${master.token}` },
      payload: {
        totalFund: '0', cashRate: '2', siegeDiamonds: '0', guildCash: '5',
        scrollCraftDiamonds: '0', instantReviveDiamonds: '0',
      },
    });
    expect(rounded.statusCode).toBe(200);
    expect((rounded.json() as { data: DistributionResponse & Record<string, string> }).data).toMatchObject({
      totalFund: '3', totals: { fundingTotalCash: '6' },
    });
  });

  it('stores currency reconciliation inputs and returns available and remaining balances', async () => {
    const app = await createApp();
    const master = await createGuild(app, 'distributionreconciliationmaster');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/distributions',
      headers: { authorization: `Bearer ${master.token}` },
      payload: {
        title: '재화 정산 입력',
        startDate: '2026-08-01',
        endDate: '2026-08-07',
        totalFund: '0',
        cashRate: '4.5',
        heldDiamonds: '293117',
        heldCash: '0',
        allianceReceivedDiamonds: '0',
        allianceReceivedCash: '1188041',
        distributionDiamonds: '280000',
        distributionCash: '900000',
      },
    });
    expect(response.statusCode).toBe(201);
    expect((response.json() as { data: DistributionResponse & Record<string, unknown> }).data).toMatchObject({
      totalFund: '480000',
      heldDiamonds: '293117',
      allianceReceivedCash: '1188041',
      distributionDiamonds: '280000',
      distributionCash: '900000',
      fundingSummary: {
        availableDiamonds: '293117',
        availableCash: '1188041',
        remainingDiamonds: '13117',
        remainingCash: '288041',
      },
    });
    const rejected = await app.inject({
      method: 'PATCH',
      url: `/api/v1/distributions/${(response.json() as { data: { id: number } }).data.id}`,
      headers: { authorization: `Bearer ${master.token}` },
      payload: { distributionDiamonds: '300000' },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json()).toMatchObject({ error: { code: 'DISTRIBUTION_DIAMONDS_EXCEEDS_AVAILABLE' } });
  });

  it('persists alliance-rate tiers per guild and applies them to new combat-power snapshots', async () => {
    const app = await createApp();
    const master = await createGuild(app, 'distributiontiermaster');
    const admin = await joinGuild(app, master.guildId, 'ADMIN', 'distributiontieradmin');
    const member = await joinGuild(app, master.guildId, 'MEMBER', 'distributiontiermember');
    app.db.prepare('UPDATE characters SET combat_power = ? WHERE user_id = ?').run(85000, master.userId);
    app.db.prepare('UPDATE characters SET combat_power = ? WHERE user_id = ?').run(107000, member.userId);

    const tiers = [
      { minCombatPower: 80000, maxCombatPower: 89999, allianceRate: '1.5' },
      { minCombatPower: 90000, maxCombatPower: 99999, allianceRate: '2' },
      { minCombatPower: 100000, maxCombatPower: 104999, allianceRate: '3' },
      { minCombatPower: 105000, maxCombatPower: 109999, allianceRate: '4.25' },
    ];
    const forbidden = await app.inject({
      method: 'PUT',
      url: '/api/v1/distributions/alliance-rate-tiers',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { tiers },
    });
    expect(forbidden.statusCode).toBe(403);

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/distributions/alliance-rate-tiers',
      headers: { authorization: `Bearer ${master.token}` },
      payload: { tiers },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ data: tiers });

    const visible = await app.inject({
      method: 'GET',
      url: '/api/v1/distributions/alliance-rate-tiers',
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(visible.statusCode).toBe(200);
    expect(visible.json()).toEqual({ data: tiers });

    const draft = await createDistribution(app, master.token);
    expect(
      draft.members.map(({ combatPower, allianceRate }) => ({ combatPower, allianceRate })),
    ).toEqual(
      expect.arrayContaining([
        { combatPower: 85000, allianceRate: '1.5' },
        { combatPower: 107000, allianceRate: '4.25' },
      ]),
    );

    const invalid = await app.inject({
      method: 'PUT',
      url: '/api/v1/distributions/alliance-rate-tiers',
      headers: { authorization: `Bearer ${master.token}` },
      payload: {
        tiers: [
          { minCombatPower: 80000, maxCombatPower: 89999, allianceRate: '1' },
          { minCombatPower: 95000, maxCombatPower: 99999, allianceRate: '2' },
        ],
      },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({
      error: { code: 'DISTRIBUTION_ALLIANCE_TIER_RANGE_INVALID' },
    });
  }, 15_000);

  it('creates active-member snapshots, supports bulk input, calculates, and confirms exact totals', async () => {
    const app = await createApp();
    const master = await createGuild(app, 'distributionmaster');
    await joinGuild(app, master.guildId, 'MEMBER', 'distributionmember');
    const draft = await createDistribution(app, master.token, '1000.1');
    expect(draft.members).toHaveLength(2);
    expect(draft).toMatchObject({ startDate: '2026-08-01', endDate: '2026-08-07' });
    expect(draft.roundingMode).toBe('ROUND');

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/v1/distributions/${draft.id}/members`,
      headers: { authorization: `Bearer ${master.token}` },
      payload: {
        members: draft.members.map((member, index) => ({
          memberId: member.id,
          participationRate: index === 0 ? null : '100',
          allianceRate: index === 0 ? '50' : '100',
          payoutMultiplier: index === 0 ? '0.5' : '1',
          instantReviveCost: index === 0 ? '100.1' : '0',
        })),
      },
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { data: DistributionResponse }).data.totals).toMatchObject({
      finalDiamonds: '1000.1',
      supportTotal: '100.1',
    });

    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/v1/distributions/${draft.id}/confirm`,
      headers: { authorization: `Bearer ${master.token}` },
    });
    expect(confirmed.statusCode).toBe(200);
    expect((confirmed.json() as { data: DistributionResponse }).data).toMatchObject({
      status: 'CONFIRMED',
      confirmedAt: expect.any(Number),
      totals: { finalDiamonds: '1000.1' },
    });
  }, 15_000);

  it('allows only MASTER writes and hides DRAFT periods from ADMIN and MEMBER', async () => {
    const app = await createApp();
    const master = await createGuild(app, 'distributionauthmaster');
    const admin = await joinGuild(app, master.guildId, 'ADMIN', 'distributionadmin');
    const member = await joinGuild(app, master.guildId, 'MEMBER', 'distributionviewer');
    const draft = await createDistribution(app, master.token);

    for (const token of [admin.token, member.token]) {
      const list = await app.inject({
        method: 'GET',
        url: '/api/v1/distributions',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toMatchObject({ data: [], meta: { total: 0 } });

      const detail = await app.inject({
        method: 'GET',
        url: `/api/v1/distributions/${draft.id}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(detail.statusCode).toBe(403);
      expect(detail.json()).toMatchObject({
        error: { code: 'DISTRIBUTION_DRAFT_FORBIDDEN' },
      });

      const write = await app.inject({
        method: 'POST',
        url: `/api/v1/distributions/${draft.id}/calculate`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(write.statusCode).toBe(403);
      expect(write.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    }

    const masterWrite = await app.inject({
      method: 'POST',
      url: `/api/v1/distributions/${draft.id}/calculate`,
      headers: { authorization: `Bearer ${master.token}` },
    });
    expect(masterWrite.statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: `/api/v1/distributions/${draft.id}/confirm`,
      headers: { authorization: `Bearer ${master.token}` },
    });
    for (const token of [admin.token, member.token]) {
      const list = await app.inject({
        method: 'GET',
        url: '/api/v1/distributions',
        headers: { authorization: `Bearer ${token}` },
      });
      expect((list.json() as { data: Array<{ id: number }> }).data).toEqual([
        expect.objectContaining({ id: draft.id }),
      ]);
      const detail = await app.inject({
        method: 'GET',
        url: `/api/v1/distributions/${draft.id}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(detail.statusCode).toBe(200);
    }
  }, 15_000);

  it('blocks confirmed edits, then permits edits after a reasoned reopen and records audit data', async () => {
    const app = await createApp();
    const master = await createGuild(app, 'distributionreopenmaster');
    const draft = await createDistribution(app, master.token);
    const memberId = draft.members[0].id;

    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/v1/distributions/${draft.id}/confirm`,
      headers: { authorization: `Bearer ${master.token}` },
    });
    expect(confirmed.statusCode).toBe(200);

    const blocked = await app.inject({
      method: 'PATCH',
      url: `/api/v1/distributions/${draft.id}/members/${memberId}`,
      headers: { authorization: `Bearer ${master.token}` },
      payload: { participationRate: '50' },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: { code: 'DISTRIBUTION_NOT_DRAFT' } });

    const reopened = await app.inject({
      method: 'POST',
      url: `/api/v1/distributions/${draft.id}/reopen`,
      headers: { authorization: `Bearer ${master.token}` },
      payload: { reason: '참여율 입력 오류 정정' },
    });
    expect(reopened.statusCode).toBe(200);
    expect((reopened.json() as { data: DistributionResponse }).data.status).toBe('DRAFT');

    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/v1/distributions/${draft.id}/members/${memberId}`,
      headers: { authorization: `Bearer ${master.token}` },
      payload: { participationRate: '50' },
    });
    expect(edited.statusCode).toBe(200);

    const audit = app.db
      .prepare(
        `SELECT reason FROM distribution_audit_logs
         WHERE distribution_id = ? AND action = 'REOPENED'`,
      )
      .get(draft.id) as { reason: string };
    expect(audit.reason).toBe('참여율 입력 오류 정정');
  });

  it('selects a rounding mode while preserving raw and payable diamond values', async () => {
    const app = await createApp();
    const master = await createGuild(app, 'distributionroundingmaster');
    const draft = await createDistribution(app, master.token, '10.5', 'ROUND');

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/distributions/${draft.id}/members/${draft.members[0].id}`,
      headers: { authorization: `Bearer ${master.token}` },
      payload: { participationRate: '100', allianceRate: '100' },
    });
    expect(updated.statusCode).toBe(200);
    const data = (updated.json() as { data: DistributionResponse }).data;
    expect(data).toMatchObject({
      roundingMode: 'ROUND',
      totals: {
        finalDiamonds: '10.5',
        payableDiamonds: '11',
        roundingDifference: '0.5',
      },
    });
    expect(data.members[0]).toMatchObject({
      finalDiamonds: '10.5',
      payableDiamonds: '11',
      roundingAdjustment: '0.5',
    });

    const floored = await app.inject({
      method: 'PATCH',
      url: `/api/v1/distributions/${draft.id}`,
      headers: { authorization: `Bearer ${master.token}` },
      payload: { roundingMode: 'FLOOR' },
    });
    expect(floored.statusCode).toBe(200);
    expect((floored.json() as { data: DistributionResponse }).data).toMatchObject({
      roundingMode: 'FLOOR',
      totals: { payableDiamonds: '10', roundingDifference: '-0.5' },
    });
    const restored = await app.inject({
      method: 'PATCH',
      url: `/api/v1/distributions/${draft.id}`,
      headers: { authorization: `Bearer ${master.token}` },
      payload: { roundingMode: 'ROUND' },
    });
    expect(restored.statusCode).toBe(200);

    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/v1/distributions/${draft.id}/confirm`,
      headers: { authorization: `Bearer ${master.token}` },
    });
    expect(confirmed.statusCode).toBe(200);
    expect((confirmed.json() as { data: DistributionResponse }).data).toMatchObject({
      status: 'CONFIRMED',
      roundingMode: 'ROUND',
      totals: { payableDiamonds: '11', roundingDifference: '0.5' },
      members: [
        expect.objectContaining({
          finalDiamonds: '10.5',
          payableDiamonds: '11',
          roundingAdjustment: '0.5',
        }),
      ],
    });
    const stored = app.db
      .prepare(
        `SELECT final_diamonds, payable_diamonds, rounding_adjustment
         FROM distribution_members WHERE id = ?`,
      )
      .get(draft.members[0].id) as {
      final_diamonds: string;
      payable_diamonds: string;
      rounding_adjustment: string;
    };
    expect({
      finalDiamonds: String(stored.final_diamonds),
      payableDiamonds: String(stored.payable_diamonds),
      roundingAdjustment: String(stored.rounding_adjustment),
    }).toEqual({
      finalDiamonds: '10.5',
      payableDiamonds: '11',
      roundingAdjustment: '0.5',
    });
  });

  it('keeps confirmed nickname/class/combat-power snapshots after the user profile changes', async () => {
    const app = await createApp();
    const master = await createGuild(app, 'distributionsnapshotmaster');
    const joined = await joinGuild(app, master.guildId, 'MEMBER', 'snapshotmember');
    const draft = await createDistribution(app, master.token);
    const snapshot = draft.members.find((member) => member.userId === joined.userId)!;
    expect(snapshot).toMatchObject({ nickname: 'snapshotmember', mainClass: '아크 메이지' });

    await app.inject({
      method: 'POST',
      url: `/api/v1/distributions/${draft.id}/confirm`,
      headers: { authorization: `Bearer ${master.token}` },
    });
    app.db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run('변경된닉네임', joined.userId);
    app.db
      .prepare('UPDATE characters SET main_class = ?, combat_power = ? WHERE user_id = ?')
      .run('디스트로이어', 999999, joined.userId);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/distributions/${draft.id}`,
      headers: { authorization: `Bearer ${master.token}` },
    });
    const stored = (detail.json() as { data: DistributionResponse }).data.members.find(
      (member) => member.userId === joined.userId,
    );
    expect(stored).toMatchObject({ nickname: 'snapshotmember', mainClass: '아크 메이지' });
  });

  it('rejects invalid weights, dates, member values, and support costs over the fund', async () => {
    const app = await createApp();
    const master = await createGuild(app, 'distributionvalidationmaster');

    const invalidWeights = await app.inject({
      method: 'POST',
      url: '/api/v1/distributions',
      headers: { authorization: `Bearer ${master.token}` },
      payload: {
        title: '잘못된 비중',
        startDate: '2026-08-01',
        endDate: '2026-08-07',
        totalFund: '100',
        participationWeight: '60',
        allianceWeight: '50',
      },
    });
    expect(invalidWeights.statusCode).toBe(422);

    const invalidDates = await app.inject({
      method: 'POST',
      url: '/api/v1/distributions',
      headers: { authorization: `Bearer ${master.token}` },
      payload: {
        title: '잘못된 날짜',
        startDate: '2026-08-08',
        endDate: '2026-08-01',
        totalFund: '100',
      },
    });
    expect(invalidDates.statusCode).toBe(422);

    const nonexistentDate = await app.inject({
      method: 'POST',
      url: '/api/v1/distributions',
      headers: { authorization: `Bearer ${master.token}` },
      payload: {
        title: '존재하지 않는 날짜',
        startDate: '2026-02-30',
        endDate: '2026-03-01',
        totalFund: '100',
      },
    });
    expect(nonexistentDate.statusCode).toBe(422);
    expect(nonexistentDate.json()).toMatchObject({
      error: { code: 'DISTRIBUTION_DATE_INVALID' },
    });

    const draft = await createDistribution(app, master.token, '100');
    const invalidRate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/distributions/${draft.id}/members/${draft.members[0].id}`,
      headers: { authorization: `Bearer ${master.token}` },
      payload: { participationRate: 101 },
    });
    expect(invalidRate.statusCode).toBe(422);

    const excessiveSupport = await app.inject({
      method: 'PATCH',
      url: `/api/v1/distributions/${draft.id}/members/${draft.members[0].id}`,
      headers: { authorization: `Bearer ${master.token}` },
      payload: { otherSupportCost: '100.01' },
    });
    expect(excessiveSupport.statusCode).toBe(422);
    expect(excessiveSupport.json()).toMatchObject({
      error: { code: 'DISTRIBUTION_SUPPORT_EXCEEDS_FUND' },
    });
    const storedCost = app.db
      .prepare('SELECT other_support_cost FROM distribution_members WHERE id = ?')
      .get(draft.members[0].id) as { other_support_cost: string };
    expect(String(storedCost.other_support_cost)).toBe('0');

    const validSupport = await app.inject({
      method: 'PATCH',
      url: `/api/v1/distributions/${draft.id}/members/${draft.members[0].id}`,
      headers: { authorization: `Bearer ${master.token}` },
      payload: { otherSupportCost: '50' },
    });
    expect(validSupport.statusCode).toBe(200);
    const fundBelowSupport = await app.inject({
      method: 'PATCH',
      url: `/api/v1/distributions/${draft.id}`,
      headers: { authorization: `Bearer ${master.token}` },
      payload: { totalFund: '40' },
    });
    expect(fundBelowSupport.statusCode).toBe(422);
    const storedFund = app.db
      .prepare('SELECT total_fund FROM distribution_periods WHERE id = ?')
      .get(draft.id) as { total_fund: string };
    expect(String(storedFund.total_fund)).toBe('100');
  }, 15_000);
});
