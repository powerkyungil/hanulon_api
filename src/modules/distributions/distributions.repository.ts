import type Database from 'better-sqlite3';

import { withTransaction } from '../../infrastructure/db/transaction';
import type { UserRole } from '../auth/auth.types';
import type {
  DistributionActor,
  DistributionAllianceRateTier,
  DistributionCalculation,
  DistributionCreateInput,
  DistributionListFilters,
  DistributionMember,
  DistributionMemberUpdateInput,
  DistributionPeriod,
  DistributionPeriodUpdateInput,
  DistributionRoundingMode,
  DistributionStatus,
} from './distributions.types';

interface ActorRow {
  id: number;
  guild_id: number;
  role: UserRole;
  is_active: number;
}

interface PeriodRow {
  id: number;
  guild_id: number;
  title: string;
  start_date_iso: string;
  end_date_iso: string;
  status: DistributionStatus;
  total_fund: string | number;
  siege_diamonds: string | number;
  guild_cash: string | number;
  scroll_craft_diamonds: string | number;
  instant_revive_diamonds: string | number;
  held_diamonds: string | number;
  held_cash: string | number;
  alliance_received_diamonds: string | number;
  alliance_received_cash: string | number;
  distribution_diamonds: string | number;
  distribution_cash: string | number;
  participation_weight: string | number;
  alliance_weight: string | number;
  cash_rate: string | number;
  rounding_mode: DistributionRoundingMode;
  created_by: number;
  created_at_ms: number;
  updated_at_ms: number;
  confirmed_at_ms: number | null;
  confirmed_by: number | null;
}

interface MemberRow {
  id: number;
  distribution_id: number;
  user_id: number;
  nickname_snapshot: string;
  occupation_snapshot: string | null;
  main_class_snapshot: string | null;
  combat_power_snapshot: number | null;
  participation_rate: string | number | null;
  alliance_rate: string | number;
  payout_multiplier: string | number;
  instant_revive_cost: string | number;
  gold_support_cost: string | number;
  operation_cost: string | number;
  other_support_cost: string | number;
  note: string | null;
  participation_share: string | number;
  alliance_share: string | number;
  participation_amount: string | number;
  alliance_amount: string | number;
  support_total: string | number;
  final_diamonds: string | number;
  payable_diamonds: string | number;
  rounding_adjustment: string | number;
  cash_amount: string | number;
}

interface AllianceRateTierRow {
  min_combat_power: number;
  max_combat_power: number;
  alliance_rate: string | number;
}

const text = (value: string | number): string => String(value);

const mapPeriod = (row: PeriodRow): DistributionPeriod => ({
  id: row.id,
  guildId: row.guild_id,
  title: row.title,
  startDate: row.start_date_iso,
  endDate: row.end_date_iso,
  status: row.status,
  totalFund: text(row.total_fund),
  siegeDiamonds: text(row.siege_diamonds),
  guildCash: text(row.guild_cash),
  scrollCraftDiamonds: text(row.scroll_craft_diamonds),
  instantReviveDiamonds: text(row.instant_revive_diamonds),
  heldDiamonds: text(row.held_diamonds),
  heldCash: text(row.held_cash),
  allianceReceivedDiamonds: text(row.alliance_received_diamonds),
  allianceReceivedCash: text(row.alliance_received_cash),
  distributionDiamonds: text(row.distribution_diamonds),
  distributionCash: text(row.distribution_cash),
  participationWeight: text(row.participation_weight),
  allianceWeight: text(row.alliance_weight),
  cashRate: text(row.cash_rate),
  roundingMode: row.rounding_mode,
  createdBy: row.created_by,
  createdAt: row.created_at_ms,
  updatedAt: row.updated_at_ms,
  confirmedAt: row.confirmed_at_ms,
  confirmedBy: row.confirmed_by,
});

const mapMember = (row: MemberRow): DistributionMember => ({
  id: row.id,
  distributionId: row.distribution_id,
  userId: row.user_id,
  nickname: row.nickname_snapshot,
  occupation: row.occupation_snapshot,
  mainClass: row.main_class_snapshot,
  combatPower: row.combat_power_snapshot,
  participationRate: row.participation_rate === null ? null : text(row.participation_rate),
  allianceRate: text(row.alliance_rate),
  payoutMultiplier: text(row.payout_multiplier),
  instantReviveCost: text(row.instant_revive_cost),
  goldSupportCost: text(row.gold_support_cost),
  operationCost: text(row.operation_cost),
  otherSupportCost: text(row.other_support_cost),
  note: row.note,
  participationShare: text(row.participation_share),
  allianceShare: text(row.alliance_share),
  participationAmount: text(row.participation_amount),
  allianceAmount: text(row.alliance_amount),
  supportTotal: text(row.support_total),
  finalDiamonds: text(row.final_diamonds),
  payableDiamonds: text(row.payable_diamonds),
  roundingAdjustment: text(row.rounding_adjustment),
  cashAmount: text(row.cash_amount),
});

const periodSelect = `
  SELECT
    id, guild_id, title, start_date_iso, end_date_iso, status, total_fund,
    siege_diamonds, guild_cash, scroll_craft_diamonds, instant_revive_diamonds,
    held_diamonds, held_cash, alliance_received_diamonds, alliance_received_cash,
    distribution_diamonds, distribution_cash,
    participation_weight, alliance_weight, cash_rate, rounding_mode, created_by, confirmed_by,
    CAST(strftime('%s', created_at) AS INTEGER) * 1000 AS created_at_ms,
    CAST(strftime('%s', updated_at) AS INTEGER) * 1000 AS updated_at_ms,
    CASE WHEN confirmed_at IS NULL THEN NULL
      ELSE CAST(strftime('%s', confirmed_at) AS INTEGER) * 1000 END AS confirmed_at_ms
  FROM distribution_periods
`;

export class DistributionsRepository {
  public constructor(private readonly db: Database.Database) {}

  public transaction<T>(operation: () => T): T {
    return withTransaction(this.db, operation);
  }

  public findActor(userId: number, guildId: number): DistributionActor | null {
    const row = this.db
      .prepare('SELECT id, guild_id, role, is_active FROM users WHERE id = ? AND guild_id = ?')
      .get(userId, guildId) as ActorRow | undefined;
    return row
      ? { id: row.id, guildId: row.guild_id, role: row.role, isActive: row.is_active === 1 }
      : null;
  }

  public findAllianceRateTiers(guildId: number): DistributionAllianceRateTier[] {
    const rows = this.db
      .prepare(
        `SELECT min_combat_power, max_combat_power, alliance_rate
         FROM distribution_alliance_rate_tiers
         WHERE guild_id = ?
         ORDER BY min_combat_power ASC`,
      )
      .all(guildId) as AllianceRateTierRow[];
    return rows.map((row) => ({
      minCombatPower: row.min_combat_power,
      maxCombatPower: row.max_combat_power,
      allianceRate: text(row.alliance_rate),
    }));
  }

  public replaceAllianceRateTiers(
    actor: DistributionActor,
    tiers: DistributionAllianceRateTier[],
  ): void {
    withTransaction(this.db, () => {
      this.db
        .prepare('DELETE FROM distribution_alliance_rate_tiers WHERE guild_id = ?')
        .run(actor.guildId);
      const insert = this.db.prepare(
        `INSERT INTO distribution_alliance_rate_tiers (
           guild_id, min_combat_power, max_combat_power, alliance_rate, updated_by
         ) VALUES (?, ?, ?, ?, ?)`,
      );
      tiers.forEach((tier) =>
        insert.run(
          actor.guildId,
          tier.minCombatPower,
          tier.maxCombatPower,
          tier.allianceRate,
          actor.id,
        ),
      );
    });
  }

  public listPeriods(
    guildId: number,
    filters: DistributionListFilters,
    confirmedOnly: boolean,
  ): DistributionPeriod[] {
    const clauses = ['guild_id = ?'];
    const params: Array<number | string> = [guildId];
    if (confirmedOnly) clauses.push("status = 'CONFIRMED'");
    else if (filters.status) {
      clauses.push('status = ?');
      params.push(filters.status);
    }
    if (filters.startDate !== undefined) {
      clauses.push('end_date_iso >= ?');
      params.push(filters.startDate);
    }
    if (filters.endDate !== undefined) {
      clauses.push('start_date_iso <= ?');
      params.push(filters.endDate);
    }
    const rows = this.db
      .prepare(
        `${periodSelect} WHERE ${clauses.join(' AND ')} ORDER BY start_date_iso DESC, id DESC`,
      )
      .all(...params) as PeriodRow[];
    return rows.map(mapPeriod);
  }

  public findPeriod(id: number, guildId: number): DistributionPeriod | null {
    const row = this.db
      .prepare(`${periodSelect} WHERE id = ? AND guild_id = ? LIMIT 1`)
      .get(id, guildId) as PeriodRow | undefined;
    return row ? mapPeriod(row) : null;
  }

  public findMembers(distributionId: number): DistributionMember[] {
    const rows = this.db
      .prepare(`SELECT * FROM distribution_members WHERE distribution_id = ? ORDER BY id ASC`)
      .all(distributionId) as MemberRow[];
    return rows.map(mapMember);
  }

  public findMember(distributionId: number, memberId: number): DistributionMember | null {
    const row = this.db
      .prepare('SELECT * FROM distribution_members WHERE distribution_id = ? AND id = ?')
      .get(distributionId, memberId) as MemberRow | undefined;
    return row ? mapMember(row) : null;
  }

  public create(actor: DistributionActor, input: DistributionCreateInput): number {
    return withTransaction(this.db, () => {
      const result = this.db
        .prepare(
          `INSERT INTO distribution_periods (
             guild_id, title, start_date, end_date, start_date_iso, end_date_iso, total_fund,
             siege_diamonds, guild_cash, scroll_craft_diamonds, instant_revive_diamonds,
             held_diamonds, held_cash, alliance_received_diamonds, alliance_received_cash,
             distribution_diamonds, distribution_cash,
             participation_weight, alliance_weight, cash_rate, rounding_mode, created_by
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          actor.guildId,
          input.title,
          Date.parse(`${input.startDate}T00:00:00+09:00`),
          Date.parse(`${input.endDate}T23:59:59.999+09:00`),
          input.startDate,
          input.endDate,
          input.totalFund,
          input.siegeDiamonds,
          input.guildCash,
          input.scrollCraftDiamonds,
          input.instantReviveDiamonds,
          input.heldDiamonds,
          input.heldCash,
          input.allianceReceivedDiamonds,
          input.allianceReceivedCash,
          input.distributionDiamonds,
          input.distributionCash,
          input.participationWeight,
          input.allianceWeight,
          input.cashRate,
          input.roundingMode,
          actor.id,
        );
      const distributionId = Number(result.lastInsertRowid);
      this.db
        .prepare(
          `INSERT INTO distribution_members (
             distribution_id, user_id, nickname_snapshot, occupation_snapshot,
             main_class_snapshot, combat_power_snapshot
           )
           SELECT ?, u.id, u.nickname, c.occupation, c.main_class, c.combat_power
           FROM users u
           LEFT JOIN characters c ON c.user_id = u.id
           WHERE u.guild_id = ? AND u.is_active = 1
           ORDER BY u.id ASC`,
        )
        .run(distributionId, actor.guildId);
      this.db
        .prepare(
          `UPDATE distribution_members
           SET alliance_rate = COALESCE((
             SELECT tier.alliance_rate
             FROM distribution_alliance_rate_tiers tier
             WHERE tier.guild_id = ?
               AND distribution_members.combat_power_snapshot BETWEEN
                 tier.min_combat_power AND tier.max_combat_power
             LIMIT 1
           ), alliance_rate)
           WHERE distribution_id = ?`,
        )
        .run(actor.guildId, distributionId);
      this.insertAudit(actor, distributionId, 'CREATED', null, {
        memberCount: this.findMembers(distributionId).length,
      });
      return distributionId;
    });
  }

  public updatePeriod(
    actor: DistributionActor,
    period: DistributionPeriod,
    input: DistributionPeriodUpdateInput,
  ): void {
    const next = { ...period, ...input };
    withTransaction(this.db, () => {
      this.db
        .prepare(
          `UPDATE distribution_periods SET
             title = ?, start_date = ?, end_date = ?, start_date_iso = ?, end_date_iso = ?,
             total_fund = ?, siege_diamonds = ?, guild_cash = ?,
             scroll_craft_diamonds = ?, instant_revive_diamonds = ?,
             held_diamonds = ?, held_cash = ?,
             alliance_received_diamonds = ?, alliance_received_cash = ?,
             distribution_diamonds = ?, distribution_cash = ?,
             participation_weight = ?, alliance_weight = ?, cash_rate = ?,
             rounding_mode = ?,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND guild_id = ? AND status = 'DRAFT'`,
        )
        .run(
          next.title,
          Date.parse(`${next.startDate}T00:00:00+09:00`),
          Date.parse(`${next.endDate}T23:59:59.999+09:00`),
          next.startDate,
          next.endDate,
          next.totalFund,
          next.siegeDiamonds,
          next.guildCash,
          next.scrollCraftDiamonds,
          next.instantReviveDiamonds,
          next.heldDiamonds,
          next.heldCash,
          next.allianceReceivedDiamonds,
          next.allianceReceivedCash,
          next.distributionDiamonds,
          next.distributionCash,
          next.participationWeight,
          next.allianceWeight,
          next.cashRate,
          next.roundingMode,
          period.id,
          actor.guildId,
        );
      this.insertAudit(actor, period.id, 'PERIOD_UPDATED', null, { input });
    });
  }

  public updateMember(
    actor: DistributionActor,
    distributionId: number,
    member: DistributionMember,
    input: DistributionMemberUpdateInput,
    audit = true,
  ): void {
    const next = { ...member, ...input };
    this.db
      .prepare(
        `UPDATE distribution_members SET
           participation_rate = ?, alliance_rate = ?, payout_multiplier = ?,
           instant_revive_cost = ?, gold_support_cost = ?, operation_cost = ?,
           other_support_cost = ?, note = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND distribution_id = ?`,
      )
      .run(
        next.participationRate,
        next.allianceRate,
        next.payoutMultiplier,
        next.instantReviveCost,
        next.goldSupportCost,
        next.operationCost,
        next.otherSupportCost,
        next.note,
        member.id,
        distributionId,
      );
    if (audit) {
      this.insertAudit(actor, distributionId, 'MEMBER_UPDATED', null, {
        memberId: member.id,
        input,
      });
    }
  }

  public updateMembersBulk(
    actor: DistributionActor,
    distributionId: number,
    updates: Array<{ member: DistributionMember; input: DistributionMemberUpdateInput }>,
  ): void {
    withTransaction(this.db, () => {
      updates.forEach(({ member, input }) =>
        this.updateMember(actor, distributionId, member, input, false),
      );
      this.insertAudit(actor, distributionId, 'MEMBERS_BULK_UPDATED', null, {
        memberIds: updates.map(({ member }) => member.id),
      });
    });
  }

  public saveCalculation(
    actor: DistributionActor,
    distributionId: number,
    calculation: DistributionCalculation,
    action: 'CALCULATED' | 'CONFIRMED',
  ): void {
    withTransaction(this.db, () => {
      const statement = this.db.prepare(
        `UPDATE distribution_members SET
           participation_share = ?, alliance_share = ?, participation_amount = ?,
           alliance_amount = ?, support_total = ?, final_diamonds = ?, payable_diamonds = ?,
           rounding_adjustment = ?, cash_amount = ?,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND distribution_id = ?`,
      );
      calculation.members.forEach((member) =>
        statement.run(
          member.participationShare,
          member.allianceShare,
          member.participationAmount,
          member.allianceAmount,
          member.supportTotal,
          member.finalDiamonds,
          member.payableDiamonds,
          member.roundingAdjustment,
          member.cashAmount,
          member.memberId,
          distributionId,
        ),
      );
      if (action === 'CONFIRMED') {
        this.db
          .prepare(
            `UPDATE distribution_periods SET status = 'CONFIRMED', confirmed_by = ?,
             confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND guild_id = ? AND status = 'DRAFT'`,
          )
          .run(actor.id, distributionId, actor.guildId);
      } else {
        this.db
          .prepare(
            `UPDATE distribution_periods SET updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND guild_id = ? AND status = 'DRAFT'`,
          )
          .run(distributionId, actor.guildId);
      }
      this.insertAudit(actor, distributionId, action, null, { totals: calculation.totals });
    });
  }

  public reopen(actor: DistributionActor, distributionId: number, reason: string): void {
    withTransaction(this.db, () => {
      this.db
        .prepare(
          `UPDATE distribution_periods SET status = 'DRAFT', confirmed_by = NULL,
           confirmed_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND guild_id = ? AND status = 'CONFIRMED'`,
        )
        .run(distributionId, actor.guildId);
      this.insertAudit(actor, distributionId, 'REOPENED', reason, {});
    });
  }

  public deleteDraft(actor: DistributionActor, distributionId: number): void {
    withTransaction(this.db, () => {
      this.insertAudit(actor, distributionId, 'DELETED', null, {});
      this.db
        .prepare(
          `DELETE FROM distribution_periods
           WHERE id = ? AND guild_id = ? AND status = 'DRAFT'`,
        )
        .run(distributionId, actor.guildId);
    });
  }

  private insertAudit(
    actor: DistributionActor,
    distributionId: number,
    action:
      | 'CREATED'
      | 'PERIOD_UPDATED'
      | 'MEMBER_UPDATED'
      | 'MEMBERS_BULK_UPDATED'
      | 'CALCULATED'
      | 'CONFIRMED'
      | 'REOPENED'
      | 'DELETED',
    reason: string | null,
    metadata: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        `INSERT INTO distribution_audit_logs (
           guild_id, distribution_id, actor_user_id, action, reason, metadata_json
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(actor.guildId, distributionId, actor.id, action, reason, JSON.stringify(metadata));
  }
}
