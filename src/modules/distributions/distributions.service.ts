import Decimal from 'decimal.js';

import { AppError } from '../../shared/errors/app-error';
import { calculateDistribution } from './distributions.calculator';
import { DistributionsRepository } from './distributions.repository';
import type {
  DistributionActor,
  DistributionAllianceRateTier,
  DistributionAllianceRateTierInput,
  DistributionCreateInput,
  DistributionDetail,
  DistributionListFilters,
  DistributionMemberUpdateInput,
  DistributionPeriod,
  DistributionPeriodUpdateInput,
} from './distributions.types';

const MAX_AMOUNT = new Decimal('999999999999999');

export class DistributionsService {
  public constructor(private readonly repository: DistributionsRepository) {}

  public list(
    userId: number,
    guildId: number,
    filters: DistributionListFilters,
  ): DistributionPeriod[] {
    const actor = this.requireActor(userId, guildId);
    if (
      (filters.startDate !== undefined && !this.isValidDate(filters.startDate)) ||
      (filters.endDate !== undefined && !this.isValidDate(filters.endDate))
    ) {
      throw new AppError(
        'DISTRIBUTION_DATE_INVALID',
        '날짜는 실제 존재하는 YYYY-MM-DD 형식이어야 합니다.',
        422,
      );
    }
    if (
      filters.startDate !== undefined &&
      filters.endDate !== undefined &&
      filters.startDate > filters.endDate
    ) {
      throw new AppError(
        'DISTRIBUTION_DATE_RANGE_INVALID',
        '조회 시작일은 종료일보다 늦을 수 없습니다.',
        422,
      );
    }
    return this.repository.listPeriods(guildId, filters, actor.role !== 'MASTER');
  }

  public getAllianceRateTiers(
    userId: number,
    guildId: number,
  ): DistributionAllianceRateTier[] {
    this.requireActor(userId, guildId);
    return this.repository.findAllianceRateTiers(guildId);
  }

  public updateAllianceRateTiers(
    userId: number,
    guildId: number,
    tiers: DistributionAllianceRateTierInput[],
  ): DistributionAllianceRateTier[] {
    const actor = this.requireMaster(userId, guildId);
    this.validateAllianceRateTiers(tiers);
    this.repository.replaceAllianceRateTiers(actor, tiers);
    return this.repository.findAllianceRateTiers(guildId);
  }

  public get(userId: number, guildId: number, distributionId: number): DistributionDetail {
    const actor = this.requireActor(userId, guildId);
    const period = this.requirePeriod(distributionId, guildId);
    if (period.status === 'DRAFT' && actor.role !== 'MASTER') {
      throw new AppError(
        'DISTRIBUTION_DRAFT_FORBIDDEN',
        '초안 분배 내역을 조회할 권한이 없습니다.',
        403,
      );
    }
    return this.detail(period);
  }

  public create(
    userId: number,
    guildId: number,
    input: DistributionCreateInput,
  ): DistributionDetail {
    const actor = this.requireMaster(userId, guildId);
    const normalized = this.normalizeCreateFunding(input);
    this.validatePeriod(normalized);
    const id = this.repository.create(actor, normalized);
    return this.detail(this.requirePeriod(id, guildId));
  }

  public updatePeriod(
    userId: number,
    guildId: number,
    distributionId: number,
    input: DistributionPeriodUpdateInput,
  ): DistributionDetail {
    const actor = this.requireMaster(userId, guildId);
    const period = this.requireDraft(distributionId, guildId);
    const normalizedInput = this.normalizeUpdateFunding(period, input);
    const next = { ...period, ...normalizedInput };
    this.validatePeriod(next);
    return this.repository.transaction(() => {
      this.repository.updatePeriod(actor, period, normalizedInput);
      return this.detail(this.requirePeriod(distributionId, guildId));
    });
  }

  public updateMember(
    userId: number,
    guildId: number,
    distributionId: number,
    memberId: number,
    input: DistributionMemberUpdateInput,
  ): DistributionDetail {
    const actor = this.requireMaster(userId, guildId);
    this.requireDraft(distributionId, guildId);
    const member = this.repository.findMember(distributionId, memberId);
    if (!member) {
      throw new AppError(
        'DISTRIBUTION_MEMBER_NOT_FOUND',
        '분배 대상 길드원 스냅샷을 찾을 수 없습니다.',
        404,
      );
    }
    this.validateMemberInput(input);
    return this.repository.transaction(() => {
      this.repository.updateMember(actor, distributionId, member, input);
      return this.calculateAndSave(actor, distributionId);
    });
  }

  public updateMembersBulk(
    userId: number,
    guildId: number,
    distributionId: number,
    inputs: Array<{ memberId: number; values: DistributionMemberUpdateInput }>,
  ): DistributionDetail {
    const actor = this.requireMaster(userId, guildId);
    this.requireDraft(distributionId, guildId);
    const seen = new Set<number>();
    const updates = inputs.map(({ memberId, values }) => {
      if (seen.has(memberId)) {
        throw new AppError(
          'DISTRIBUTION_MEMBER_DUPLICATED',
          '일괄 입력에 같은 길드원이 중복되었습니다.',
          422,
        );
      }
      seen.add(memberId);
      const member = this.repository.findMember(distributionId, memberId);
      if (!member) {
        throw new AppError(
          'DISTRIBUTION_MEMBER_NOT_FOUND',
          '분배 대상 길드원 스냅샷을 찾을 수 없습니다.',
          404,
          { memberId },
        );
      }
      this.validateMemberInput(values);
      return { member, input: values };
    });
    return this.repository.transaction(() => {
      this.repository.updateMembersBulk(actor, distributionId, updates);
      return this.calculateAndSave(actor, distributionId);
    });
  }

  public calculate(userId: number, guildId: number, distributionId: number): DistributionDetail {
    const actor = this.requireMaster(userId, guildId);
    this.requireDraft(distributionId, guildId);
    return this.calculateAndSave(actor, distributionId);
  }

  public confirm(userId: number, guildId: number, distributionId: number): DistributionDetail {
    const actor = this.requireMaster(userId, guildId);
    const period = this.requireDraft(distributionId, guildId);
    const members = this.repository.findMembers(distributionId);
    const calculation = calculateDistribution(period, members);
    this.repository.saveCalculation(actor, distributionId, calculation, 'CONFIRMED');
    return this.detail(this.requirePeriod(distributionId, guildId));
  }

  public reopen(
    userId: number,
    guildId: number,
    distributionId: number,
    reason: string,
  ): DistributionDetail {
    const actor = this.requireMaster(userId, guildId);
    const period = this.requirePeriod(distributionId, guildId);
    if (period.status !== 'CONFIRMED') {
      throw new AppError(
        'DISTRIBUTION_NOT_CONFIRMED',
        '확정된 분배 내역만 재개방할 수 있습니다.',
        409,
      );
    }
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      throw new AppError(
        'DISTRIBUTION_REOPEN_REASON_REQUIRED',
        '재개방 사유를 입력해야 합니다.',
        422,
      );
    }
    this.repository.reopen(actor, distributionId, normalizedReason);
    return this.detail(this.requirePeriod(distributionId, guildId));
  }

  public delete(userId: number, guildId: number, distributionId: number): void {
    const actor = this.requireMaster(userId, guildId);
    this.requireDraft(distributionId, guildId);
    this.repository.deleteDraft(actor, distributionId);
  }

  private calculateAndSave(actor: DistributionActor, distributionId: number): DistributionDetail {
    const period = this.requireDraft(distributionId, actor.guildId);
    const calculation = calculateDistribution(period, this.repository.findMembers(distributionId));
    this.repository.saveCalculation(actor, distributionId, calculation, 'CALCULATED');
    return this.detail(this.requirePeriod(distributionId, actor.guildId));
  }

  private detail(period: DistributionPeriod): DistributionDetail {
    const members = this.repository.findMembers(period.id);
    if (period.status === 'CONFIRMED') {
      return {
        ...period,
        members,
        totals: this.storedTotals(period, members),
        fundingSummary: this.fundingSummary(period),
      };
    }
    const calculation = calculateDistribution(period, members);
    const calculationByMember = new Map(
      calculation.members.map((member) => [member.memberId, member]),
    );
    return {
      ...period,
      members: members.map((member) => ({
        ...member,
        ...(calculationByMember.get(member.id) ?? {}),
      })),
      totals: calculation.totals,
      fundingSummary: this.fundingSummary(period),
    };
  }

  private storedTotals(
    period: DistributionPeriod,
    members: ReturnType<DistributionsRepository['findMembers']>,
  ) {
    const sum = (values: string[]): Decimal =>
      values.reduce((total, value) => total.plus(value), new Decimal(0));
    const supportTotal = sum(members.map((member) => member.supportTotal));
    const baseFund = new Decimal(period.totalFund).minus(supportTotal);
    const participationPool = baseFund.times(period.participationWeight).dividedBy(100);
    const alliancePool = baseFund.times(period.allianceWeight).dividedBy(100);
    const participationAllocated = sum(members.map((member) => member.participationAmount));
    const allianceAllocated = sum(members.map((member) => member.allianceAmount));
    const finalDiamonds = supportTotal.plus(participationAllocated).plus(allianceAllocated);
    const payableDiamonds = sum(members.map((member) => member.payableDiamonds));
    const asText = (value: Decimal): string => (value.isZero() ? '0' : value.toString());
    return {
      supportTotal: asText(supportTotal),
      baseFund: asText(baseFund),
      participationPool: asText(participationPool),
      alliancePool: asText(alliancePool),
      participationAllocated: asText(participationAllocated),
      allianceAllocated: asText(allianceAllocated),
      finalDiamonds: asText(finalDiamonds),
      payableDiamonds: asText(payableDiamonds),
      roundingDifference: asText(payableDiamonds.minus(finalDiamonds)),
      cashAmount: asText(finalDiamonds.times(period.cashRate)),
      undistributedDiamonds: asText(new Decimal(period.totalFund).minus(finalDiamonds)),
      fundingTotalCash: asText(new Decimal(period.totalFund).times(period.cashRate)),
      baseFundCash: asText(baseFund.times(period.cashRate)),
      supportTotalCash: asText(supportTotal.times(period.cashRate)),
    };
  }

  private fundingSummary(period: DistributionPeriod) {
    const heldDiamonds = new Decimal(period.heldDiamonds);
    const heldCash = new Decimal(period.heldCash);
    const allianceReceivedDiamonds = new Decimal(period.allianceReceivedDiamonds);
    const allianceReceivedCash = new Decimal(period.allianceReceivedCash);
    const distributionDiamonds = new Decimal(period.distributionDiamonds);
    const distributionCash = new Decimal(period.distributionCash);
    const asText = (value: Decimal): string => (value.isZero() ? '0' : value.toString());
    return {
      availableDiamonds: asText(heldDiamonds.plus(allianceReceivedDiamonds)),
      availableCash: asText(heldCash.plus(allianceReceivedCash)),
      distributionDiamonds: asText(distributionDiamonds),
      distributionCash: asText(distributionCash),
      remainingDiamonds: asText(heldDiamonds.plus(allianceReceivedDiamonds).minus(distributionDiamonds)),
      remainingCash: asText(heldCash.plus(allianceReceivedCash).minus(distributionCash)),
    };
  }

  private validatePeriod(input: DistributionCreateInput | DistributionPeriod): void {
    if (!input.title.trim()) {
      throw new AppError('DISTRIBUTION_TITLE_REQUIRED', '제목을 입력해야 합니다.', 422);
    }
    if (!this.isValidDate(input.startDate) || !this.isValidDate(input.endDate)) {
      throw new AppError(
        'DISTRIBUTION_DATE_INVALID',
        '날짜는 실제 존재하는 YYYY-MM-DD 형식이어야 합니다.',
        422,
      );
    }
    if (input.startDate > input.endDate) {
      throw new AppError(
        'DISTRIBUTION_DATE_RANGE_INVALID',
        '시작일은 종료일보다 늦을 수 없습니다.',
        422,
      );
    }
    const totalFund = this.requireDecimal(input.totalFund, '전체 분배 재원');
    const participationWeight = this.requireDecimal(input.participationWeight, '참여율 배분 비중');
    const allianceWeight = this.requireDecimal(input.allianceWeight, '연합분배율 배분 비중');
    const cashRate = this.requireDecimal(input.cashRate, '현금 환산율');
    const fundingValues = [
      ['공성 다이아', input.siegeDiamonds],
      ['길드 현금', input.guildCash],
      ['스크롤 제작', input.scrollCraftDiamonds],
      ['즉시부활', input.instantReviveDiamonds],
      ['현재 보유 다이아', input.heldDiamonds],
      ['현재 보유 현금', input.heldCash],
      ['이번 연합 수령 다이아', input.allianceReceivedDiamonds],
      ['이번 연합 수령 현금', input.allianceReceivedCash],
      ['실제 분배 다이아', input.distributionDiamonds],
      ['실제 분배 현금', input.distributionCash],
    ] as const;
    if (
      totalFund.isNegative() ||
      totalFund.greaterThan(MAX_AMOUNT) ||
      participationWeight.isNegative() ||
      allianceWeight.isNegative() ||
      cashRate.isNegative()
    ) {
      throw new AppError(
        'DISTRIBUTION_DECIMAL_OUT_OF_RANGE',
        '분배 재원, 비중, 환산율은 허용 범위의 0 이상 값이어야 합니다.',
        422,
      );
    }
    fundingValues.forEach(([label, value]) => this.requireNonNegative(value, label));
    const availableDiamonds = new Decimal(input.heldDiamonds).plus(input.allianceReceivedDiamonds);
    const availableCash = new Decimal(input.heldCash).plus(input.allianceReceivedCash);
    if (new Decimal(input.distributionDiamonds).greaterThan(availableDiamonds)) {
      throw new AppError(
        'DISTRIBUTION_DIAMONDS_EXCEEDS_AVAILABLE',
        '실제 분배 다이아가 보유 다이아와 이번 연합 수령 다이아의 합계를 초과합니다.',
        422,
        { availableDiamonds: availableDiamonds.toString(), distributionDiamonds: input.distributionDiamonds },
      );
    }
    if (new Decimal(input.distributionCash).greaterThan(availableCash)) {
      throw new AppError(
        'DISTRIBUTION_CASH_EXCEEDS_AVAILABLE',
        '실제 분배 현금이 보유 현금과 이번 연합 수령 현금의 합계를 초과합니다.',
        422,
        { availableCash: availableCash.toString(), distributionCash: input.distributionCash },
      );
    }
    if (!participationWeight.plus(allianceWeight).equals(100)) {
      throw new AppError(
        'DISTRIBUTION_WEIGHT_SUM_INVALID',
        '참여율 비중과 연합분배율 비중의 합은 100이어야 합니다.',
        422,
      );
    }
  }

  private normalizeCreateFunding(input: DistributionCreateInput): DistributionCreateInput {
    const normalized = {
      ...input,
      totalFund: input.totalFund,
      heldDiamonds: input.heldDiamonds ?? this.legacyDistributionDiamonds(input),
      heldCash: input.heldCash ?? input.distributionCash ?? input.guildCash,
      allianceReceivedDiamonds: input.allianceReceivedDiamonds ?? '0',
      allianceReceivedCash: input.allianceReceivedCash ?? '0',
      distributionDiamonds: input.distributionDiamonds ?? this.legacyDistributionDiamonds(input),
      distributionCash: input.distributionCash ?? input.guildCash,
    };
    return normalized.deriveFundingTotal
      ? { ...normalized, totalFund: this.derivedFundingTotal(normalized) }
      : normalized;
  }

  private normalizeUpdateFunding(
    period: DistributionPeriod,
    input: DistributionPeriodUpdateInput,
  ): DistributionPeriodUpdateInput {
    const sourceKeys = [
      'siegeDiamonds',
      'guildCash',
      'scrollCraftDiamonds',
      'instantReviveDiamonds',
    ] as const;
    const reconciliationKeys = [
      'heldDiamonds',
      'heldCash',
      'allianceReceivedDiamonds',
      'allianceReceivedCash',
      'distributionDiamonds',
      'distributionCash',
    ] as const;
    const hasSourceUpdate = sourceKeys.some((key) => input[key] !== undefined);
    const hasReconciliationUpdate = reconciliationKeys.some((key) => input[key] !== undefined);
    if (!hasSourceUpdate && !hasReconciliationUpdate && input.totalFund !== undefined) {
      return {
        ...input,
        siegeDiamonds: input.totalFund,
        guildCash: '0',
        scrollCraftDiamonds: '0',
        instantReviveDiamonds: '0',
        distributionDiamonds: input.totalFund,
        distributionCash: '0',
      };
    }
    if (!hasSourceUpdate && !hasReconciliationUpdate && input.cashRate === undefined) return input;
    const next = { ...period, ...input };
    const distributionDiamonds = hasReconciliationUpdate
      ? next.distributionDiamonds
      : this.legacyDistributionDiamonds(next);
    const distributionCash = hasReconciliationUpdate ? next.distributionCash : next.guildCash;
    return {
      ...input,
      ...(hasReconciliationUpdate
        ? {}
        : { heldDiamonds: distributionDiamonds, heldCash: distributionCash }),
      distributionDiamonds,
      distributionCash,
      totalFund: this.derivedFundingTotal({ ...next, distributionDiamonds, distributionCash }),
    };
  }

  private legacyDistributionDiamonds(
    input: Pick<DistributionPeriod, 'siegeDiamonds' | 'scrollCraftDiamonds' | 'instantReviveDiamonds'>,
  ): string {
    return new Decimal(input.siegeDiamonds)
      .plus(input.scrollCraftDiamonds)
      .plus(input.instantReviveDiamonds)
      .toString();
  }

  private derivedFundingTotal(
    input: Pick<DistributionPeriod, 'distributionDiamonds' | 'distributionCash' | 'cashRate'>,
  ): string {
    const cashRate = this.requireDecimal(input.cashRate, '현금 환산율');
    const distributionCash = this.requireDecimal(input.distributionCash, '실제 분배 현금');
    if (cashRate.isZero() && !distributionCash.isZero()) {
      throw new AppError(
        'DISTRIBUTION_CASH_RATE_REQUIRED',
        '길드 현금이 있으면 현금 환산율은 0보다 커야 합니다.',
        422,
      );
    }
    const cashDiamonds = cashRate.isZero() ? new Decimal(0) : distributionCash.dividedBy(cashRate);
    const total = new Decimal(input.distributionDiamonds).plus(cashDiamonds);
    const rounded = total.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    return rounded.isZero() ? '0' : rounded.toString();
  }

  private isValidDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  private validateMemberInput(input: DistributionMemberUpdateInput): void {
    if (input.participationRate !== undefined && input.participationRate !== null) {
      const value = this.requireDecimal(input.participationRate, '참여율');
      if (value.isNegative() || value.greaterThan(100)) {
        throw new AppError(
          'DISTRIBUTION_PARTICIPATION_RATE_INVALID',
          '참여율은 0 이상 100 이하여야 합니다.',
          422,
        );
      }
    }
    if (input.allianceRate !== undefined) {
      this.requireNonNegative(input.allianceRate, '연합분배율');
    }
    if (input.payoutMultiplier !== undefined) {
      const value = this.requireDecimal(input.payoutMultiplier, '지급 배율');
      if (value.isNegative() || value.greaterThan(1)) {
        throw new AppError(
          'DISTRIBUTION_MULTIPLIER_INVALID',
          '지급 배율은 0 이상 1 이하여야 합니다.',
          422,
        );
      }
    }
    for (const [label, value] of [
      ['즉시부활비', input.instantReviveCost],
      ['골드지원비', input.goldSupportCost],
      ['운영비', input.operationCost],
      ['기타 지원비', input.otherSupportCost],
    ] as const) {
      if (value !== undefined) this.requireNonNegative(value, label);
    }
  }

  private validateAllianceRateTiers(tiers: DistributionAllianceRateTierInput[]): void {
    let expectedMin = 80000;
    tiers.forEach((tier, index) => {
      const expectedMax = index === 0 ? 89999 : index === 1 ? 99999 : expectedMin + 4999;
      if (tier.minCombatPower !== expectedMin || tier.maxCombatPower !== expectedMax) {
        throw new AppError(
          'DISTRIBUTION_ALLIANCE_TIER_RANGE_INVALID',
          '연합분배율 구간은 8만, 9만, 10만부터 시작하고 이후 5천 단위로 연속되어야 합니다.',
          422,
        );
      }
      this.requireNonNegative(tier.allianceRate, '연합분배율');
      expectedMin = expectedMax + 1;
    });
  }

  private requireNonNegative(value: string, label: string): void {
    const parsed = this.requireDecimal(value, label);
    if (parsed.isNegative() || parsed.greaterThan(MAX_AMOUNT)) {
      throw new AppError(
        'DISTRIBUTION_AMOUNT_INVALID',
        `${label}은 허용 범위의 0 이상 값이어야 합니다.`,
        422,
      );
    }
  }

  private requireDecimal(value: string, label: string): Decimal {
    try {
      const parsed = new Decimal(value);
      if (!parsed.isFinite()) throw new Error('not finite');
      return parsed;
    } catch {
      throw new AppError(
        'DISTRIBUTION_DECIMAL_INVALID',
        `${label}의 숫자 형식이 올바르지 않습니다.`,
        422,
      );
    }
  }

  private requireActor(userId: number, guildId: number): DistributionActor {
    const actor = this.repository.findActor(userId, guildId);
    if (!actor || !actor.isActive) {
      throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    }
    return actor;
  }

  private requireMaster(userId: number, guildId: number): DistributionActor {
    const actor = this.requireActor(userId, guildId);
    if (actor.role !== 'MASTER') {
      throw new AppError('FORBIDDEN', '길드 분배 관리 권한이 없습니다.', 403);
    }
    return actor;
  }

  private requirePeriod(distributionId: number, guildId: number): DistributionPeriod {
    const period = this.repository.findPeriod(distributionId, guildId);
    if (!period) {
      throw new AppError('DISTRIBUTION_NOT_FOUND', '길드 분배 내역을 찾을 수 없습니다.', 404);
    }
    return period;
  }

  private requireDraft(distributionId: number, guildId: number): DistributionPeriod {
    const period = this.requirePeriod(distributionId, guildId);
    if (period.status !== 'DRAFT') {
      throw new AppError(
        'DISTRIBUTION_NOT_DRAFT',
        '초안 상태의 분배 내역만 수정할 수 있습니다.',
        409,
      );
    }
    return period;
  }
}
