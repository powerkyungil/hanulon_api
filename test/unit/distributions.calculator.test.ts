import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { calculateDistribution } from '../../src/modules/distributions/distributions.calculator';
import type {
  DistributionMember,
  DistributionPeriod,
} from '../../src/modules/distributions/distributions.types';

const period = (totalFund = '1000'): DistributionPeriod => ({
  id: 1,
  guildId: 1,
  title: '1회차',
  startDate: '2026-08-01',
  endDate: '2026-08-07',
  status: 'DRAFT',
  totalFund,
  siegeDiamonds: totalFund,
  guildCash: '0',
  scrollCraftDiamonds: '0',
  instantReviveDiamonds: '0',
  heldDiamonds: totalFund,
  heldCash: '0',
  allianceReceivedDiamonds: '0',
  allianceReceivedCash: '0',
  distributionDiamonds: totalFund,
  distributionCash: '0',
  participationWeight: '50',
  allianceWeight: '50',
  cashRate: '4.5',
  roundingMode: 'NONE',
  createdBy: 1,
  createdAt: 1,
  updatedAt: 1,
  confirmedAt: null,
  confirmedBy: null,
});

const member = (id: number, values: Partial<DistributionMember> = {}): DistributionMember => ({
  id,
  distributionId: 1,
  userId: id,
  nickname: `회원${id}`,
  occupation: null,
  mainClass: null,
  combatPower: null,
  participationRate: '100',
  allianceRate: '100',
  payoutMultiplier: '1',
  instantReviveCost: '0',
  goldSupportCost: '0',
  operationCost: '0',
  otherSupportCost: '0',
  note: null,
  participationShare: '0',
  allianceShare: '0',
  participationAmount: '0',
  allianceAmount: '0',
  supportTotal: '0',
  finalDiamonds: '0',
  payableDiamonds: '0',
  roundingAdjustment: '0',
  cashAmount: '0',
  ...values,
});

describe('distribution calculator', () => {
  it('distributes 50/50 pools and normalizes different participation and alliance rates', () => {
    const result = calculateDistribution(period(), [
      member(1, { participationRate: '100', allianceRate: '25' }),
      member(2, { participationRate: '50', allianceRate: '75' }),
    ]);

    expect(new Decimal(result.members[0].participationShare).equals(new Decimal(2).div(3))).toBe(
      true,
    );
    expect(result.members[0].allianceShare).toBe('0.25');
    expect(
      new Decimal(result.members[0].finalDiamonds).equals(new Decimal(500).div(3).mul(2).plus(125)),
    ).toBe(true);
    expect(result.totals.participationPool).toBe('500');
    expect(result.totals.alliancePool).toBe('500');
    expect(result.totals.finalDiamonds).toBe('1000');
  });

  it('applies a 50% payout multiplier before normalization', () => {
    const result = calculateDistribution(period(), [
      member(1, { payoutMultiplier: '0.5' }),
      member(2),
    ]);
    expect(new Decimal(result.members[0].participationShare).equals(new Decimal(1).div(3))).toBe(
      true,
    );
    expect(new Decimal(result.members[0].allianceShare).equals(new Decimal(1).div(3))).toBe(true);
    expect(
      new Decimal(result.members[0].finalDiamonds)
        .minus(new Decimal(1000).div(3))
        .abs()
        .lessThan('1e-45'),
    ).toBe(true);
  });

  it('excludes a 0% multiplier from base pools but still pays support costs', () => {
    const result = calculateDistribution(period(), [
      member(1, { payoutMultiplier: '0', instantReviveCost: '100.25' }),
      member(2),
    ]);
    expect(result.members[0]).toMatchObject({
      participationAmount: '0',
      allianceAmount: '0',
      supportTotal: '100.25',
      finalDiamonds: '100.25',
    });
    expect(result.members[1].finalDiamonds).toBe('899.75');
    expect(result.totals.finalDiamonds).toBe('1000');
  });

  it('treats missing and zero participation as zero and safely handles zero denominators', () => {
    const result = calculateDistribution(period(), [
      member(1, { participationRate: null, allianceRate: '0' }),
      member(2, { participationRate: '0', allianceRate: '0' }),
    ]);
    expect(result.members.every((item) => item.participationShare === '0')).toBe(true);
    expect(result.members.every((item) => item.allianceShare === '0')).toBe(true);
    expect(result.members.every((item) => item.finalDiamonds === '0')).toBe(true);
    expect(result.totals.undistributedDiamonds).toBe('1000');
  });

  it('leaves only the participation pool undistributed when every participation rate is zero', () => {
    const result = calculateDistribution(period(), [
      member(1, { participationRate: '0', allianceRate: '1' }),
      member(2, { participationRate: '0', allianceRate: '3' }),
    ]);
    expect(result.totals.participationAllocated).toBe('0');
    expect(result.totals.allianceAllocated).toBe('500');
    expect(result.totals.finalDiamonds).toBe('500');
    expect(result.totals.undistributedDiamonds).toBe('500');
  });

  it('leaves only the alliance pool undistributed when every alliance rate is zero', () => {
    const result = calculateDistribution(period(), [
      member(1, { participationRate: '1', allianceRate: '0' }),
      member(2, { participationRate: '3', allianceRate: '0' }),
    ]);
    expect(result.totals.participationAllocated).toBe('500');
    expect(result.totals.allianceAllocated).toBe('0');
    expect(result.totals.finalDiamonds).toBe('500');
    expect(result.totals.undistributedDiamonds).toBe('500');
  });

  it('deducts every support category before allocating and preserves decimal precision', () => {
    const result = calculateDistribution(period('1000.1'), [
      member(1, {
        instantReviveCost: '10.01',
        goldSupportCost: '20.02',
        operationCost: '30.03',
        otherSupportCost: '40.04',
      }),
      member(2),
    ]);
    expect(result.totals.supportTotal).toBe('100.1');
    expect(result.totals.baseFund).toBe('900');
    expect(result.members[0].supportTotal).toBe('100.1');
    expect(result.totals.finalDiamonds).toBe('1000.1');
    expect(result.totals.undistributedDiamonds).toBe('0');
  });

  it('normalizes aggregate totals after high-precision member allocation', () => {
    const result = calculateDistribution({ ...period('557126'), roundingMode: 'ROUND' }, [
      member(1, {
        participationRate: '87.5',
        allianceRate: '95',
        goldSupportCost: '1050',
      }),
      member(2, {
        participationRate: '94.32',
        allianceRate: '65',
        goldSupportCost: '1050',
      }),
      member(3, {
        participationRate: '65.91',
        allianceRate: '25',
        goldSupportCost: '4950',
      }),
      member(4, {
        participationRate: '35.8',
        allianceRate: '0.3',
        payoutMultiplier: '0.5',
        goldSupportCost: '168',
      }),
    ]);

    expect(result.totals.finalDiamonds).toBe('557126');
    expect(result.totals.undistributedDiamonds).toBe('0');
    expect(result.totals.cashAmount).toBe('2507067');
    expect(result.totals.roundingDifference).toBe(
      new Decimal(result.totals.payableDiamonds).minus('557126').toString(),
    );
  });

  it('rejects support costs greater than the total fund', () => {
    expect(() =>
      calculateDistribution(period('100'), [member(1, { otherSupportCost: '100.01' })]),
    ).toThrowError(expect.objectContaining({ code: 'DISTRIBUTION_SUPPORT_EXCEEDS_FUND' }));
  });

  it('handles an empty member snapshot without NaN or Infinity', () => {
    const result = calculateDistribution(period(), []);
    expect(result.members).toEqual([]);
    expect(result.totals).toMatchObject({ finalDiamonds: '0', undistributedDiamonds: '1000' });
  });

  it.each([
    ['NONE', '10.5', '0'],
    ['ROUND', '11', '0.5'],
    ['CEIL', '11', '0.5'],
    ['FLOOR', '10', '-0.5'],
  ] as const)('applies %s only to final payable diamonds', (roundingMode, payable, adjustment) => {
    const result = calculateDistribution({ ...period('10.5'), roundingMode }, [member(1)]);
    expect(result.members[0]).toMatchObject({
      finalDiamonds: '10.5',
      payableDiamonds: payable,
      roundingAdjustment: adjustment,
    });
    expect(result.totals).toMatchObject({
      finalDiamonds: '10.5',
      payableDiamonds: payable,
      roundingDifference: adjustment,
    });
  });
});
