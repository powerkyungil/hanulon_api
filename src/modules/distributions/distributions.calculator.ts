import Decimal from 'decimal.js';

import { AppError } from '../../shared/errors/app-error';
import type {
  DistributionCalculation,
  DistributionMember,
  DistributionPeriod,
  DistributionRoundingMode,
} from './distributions.types';

Decimal.set({ precision: 50, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -30, toExpPos: 50 });

const zero = new Decimal(0);
const decimal = (value: string | null): Decimal => new Decimal(value ?? 0);
const asText = (value: Decimal): string => (value.isZero() ? '0' : value.toString());
const sum = (values: Decimal[]): Decimal =>
  values.reduce((total, value) => total.plus(value), new Decimal(0));

interface Allocation {
  shares: Decimal[];
  amounts: Decimal[];
}

const payableFor = (value: Decimal, mode: DistributionRoundingMode): Decimal => {
  if (mode === 'NONE') return value;
  const rounding = {
    ROUND: Decimal.ROUND_HALF_UP,
    CEIL: Decimal.ROUND_CEIL,
    FLOOR: Decimal.ROUND_FLOOR,
  }[mode];
  return value.toDecimalPlaces(0, rounding);
};

const allocate = (pool: Decimal, effectiveValues: Decimal[]): Allocation => {
  const denominator = sum(effectiveValues);
  if (denominator.isZero()) {
    return {
      shares: effectiveValues.map(() => zero),
      amounts: effectiveValues.map(() => zero),
    };
  }

  let lastEligibleIndex = -1;
  effectiveValues.forEach((value, index) => {
    if (value.greaterThan(0)) lastEligibleIndex = index;
  });
  let allocatedShare = zero;
  let allocatedAmount = zero;
  const shares: Decimal[] = [];
  const amounts: Decimal[] = [];

  effectiveValues.forEach((value, index) => {
    if (value.isZero()) {
      shares.push(zero);
      amounts.push(zero);
      return;
    }
    if (index === lastEligibleIndex) {
      shares.push(new Decimal(1).minus(allocatedShare));
      amounts.push(pool.minus(allocatedAmount));
      return;
    }
    const share = value.dividedBy(denominator);
    const amount = pool.times(share);
    shares.push(share);
    amounts.push(amount);
    allocatedShare = allocatedShare.plus(share);
    allocatedAmount = allocatedAmount.plus(amount);
  });

  return { shares, amounts };
};

export const calculateDistribution = (
  period: DistributionPeriod,
  members: DistributionMember[],
): DistributionCalculation => {
  const totalFund = decimal(period.totalFund);
  const supportTotals = members.map((member) =>
    Decimal.sum(
      member.instantReviveCost,
      member.goldSupportCost,
      member.operationCost,
      member.otherSupportCost,
    ),
  );
  const supportTotal = sum(supportTotals);
  if (supportTotal.greaterThan(totalFund)) {
    throw new AppError(
      'DISTRIBUTION_SUPPORT_EXCEEDS_FUND',
      '전체 지원비가 전체 분배 재원을 초과합니다.',
      422,
      { totalFund: asText(totalFund), supportTotal: asText(supportTotal) },
    );
  }

  const baseFund = totalFund.minus(supportTotal);
  const participationPool = baseFund.times(decimal(period.participationWeight)).dividedBy(100);
  const alliancePool = baseFund.times(decimal(period.allianceWeight)).dividedBy(100);
  const effectiveParticipation = members.map((member) =>
    decimal(member.participationRate).times(member.payoutMultiplier),
  );
  const effectiveAlliance = members.map((member) =>
    decimal(member.allianceRate).times(member.payoutMultiplier),
  );
  const participation = allocate(participationPool, effectiveParticipation);
  const alliance = allocate(alliancePool, effectiveAlliance);

  const calculatedMembers = members.map((member, index) => {
    const finalDiamonds = participation.amounts[index]
      .plus(alliance.amounts[index])
      .plus(supportTotals[index]);
    const payableDiamonds = payableFor(finalDiamonds, period.roundingMode);
    return {
      memberId: member.id,
      participationShare: asText(participation.shares[index]),
      allianceShare: asText(alliance.shares[index]),
      participationAmount: asText(participation.amounts[index]),
      allianceAmount: asText(alliance.amounts[index]),
      supportTotal: asText(supportTotals[index]),
      finalDiamonds: asText(finalDiamonds),
      payableDiamonds: asText(payableDiamonds),
      roundingAdjustment: asText(payableDiamonds.minus(finalDiamonds)),
      cashAmount: asText(finalDiamonds.times(period.cashRate)),
    };
  });
  const participationAllocated = sum(participation.amounts);
  const allianceAllocated = sum(alliance.amounts);
  // Aggregate the authoritative pools instead of re-summing member-level values in a
  // different order. Re-association at the configured precision can otherwise expose
  // meaningless residuals such as 5e-44 even though every pool was fully allocated.
  const finalDiamonds = supportTotal.plus(participationAllocated).plus(allianceAllocated);
  const payableDiamonds = sum(
    calculatedMembers.map((member) => new Decimal(member.payableDiamonds)),
  );

  return {
    members: calculatedMembers,
    totals: {
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
      undistributedDiamonds: asText(totalFund.minus(finalDiamonds)),
      fundingTotalCash: asText(totalFund.times(period.cashRate)),
      baseFundCash: asText(baseFund.times(period.cashRate)),
      supportTotalCash: asText(supportTotal.times(period.cashRate)),
    },
  };
};
