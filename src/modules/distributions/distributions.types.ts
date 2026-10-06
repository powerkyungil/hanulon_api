import type { UserRole } from '../auth/auth.types';

export const distributionStatuses = ['DRAFT', 'CONFIRMED'] as const;
export type DistributionStatus = (typeof distributionStatuses)[number];
export const distributionRoundingModes = ['NONE', 'ROUND', 'CEIL', 'FLOOR'] as const;
export type DistributionRoundingMode = (typeof distributionRoundingModes)[number];

export interface DistributionActor {
  id: number;
  guildId: number;
  role: UserRole;
  isActive: boolean;
}

export interface DistributionAllianceRateTier {
  minCombatPower: number;
  maxCombatPower: number;
  allianceRate: string;
}

export type DistributionAllianceRateTierInput = DistributionAllianceRateTier;

export interface DistributionPeriod {
  id: number;
  guildId: number;
  title: string;
  startDate: string;
  endDate: string;
  status: DistributionStatus;
  totalFund: string;
  siegeDiamonds: string;
  guildCash: string;
  scrollCraftDiamonds: string;
  instantReviveDiamonds: string;
  heldDiamonds: string;
  heldCash: string;
  allianceReceivedDiamonds: string;
  allianceReceivedCash: string;
  distributionDiamonds: string;
  distributionCash: string;
  participationWeight: string;
  allianceWeight: string;
  cashRate: string;
  roundingMode: DistributionRoundingMode;
  createdBy: number;
  createdAt: number;
  updatedAt: number;
  confirmedAt: number | null;
  confirmedBy: number | null;
}

export interface DistributionMember {
  id: number;
  distributionId: number;
  userId: number;
  nickname: string;
  occupation: string | null;
  mainClass: string | null;
  combatPower: number | null;
  participationRate: string | null;
  allianceRate: string;
  payoutMultiplier: string;
  instantReviveCost: string;
  goldSupportCost: string;
  operationCost: string;
  otherSupportCost: string;
  note: string | null;
  participationShare: string;
  allianceShare: string;
  participationAmount: string;
  allianceAmount: string;
  supportTotal: string;
  finalDiamonds: string;
  payableDiamonds: string;
  roundingAdjustment: string;
  cashAmount: string;
}

export interface DistributionDetail extends DistributionPeriod {
  members: DistributionMember[];
  totals: DistributionCalculationTotals;
  fundingSummary: DistributionFundingSummary;
}

export interface DistributionFundingSummary {
  availableDiamonds: string;
  availableCash: string;
  distributionDiamonds: string;
  distributionCash: string;
  remainingDiamonds: string;
  remainingCash: string;
}

export interface DistributionCalculationTotals {
  supportTotal: string;
  baseFund: string;
  participationPool: string;
  alliancePool: string;
  participationAllocated: string;
  allianceAllocated: string;
  finalDiamonds: string;
  payableDiamonds: string;
  roundingDifference: string;
  cashAmount: string;
  undistributedDiamonds: string;
  fundingTotalCash: string;
  baseFundCash: string;
  supportTotalCash: string;
}

export interface DistributionCreateInput {
  title: string;
  startDate: string;
  endDate: string;
  totalFund: string;
  siegeDiamonds: string;
  guildCash: string;
  scrollCraftDiamonds: string;
  instantReviveDiamonds: string;
  heldDiamonds: string;
  heldCash: string;
  allianceReceivedDiamonds: string;
  allianceReceivedCash: string;
  distributionDiamonds: string;
  distributionCash: string;
  deriveFundingTotal?: boolean;
  participationWeight: string;
  allianceWeight: string;
  cashRate: string;
  roundingMode: DistributionRoundingMode;
}

export type DistributionPeriodUpdateInput = Partial<DistributionCreateInput>;

export interface DistributionMemberUpdateInput {
  participationRate?: string | null;
  allianceRate?: string;
  payoutMultiplier?: string;
  instantReviveCost?: string;
  goldSupportCost?: string;
  operationCost?: string;
  otherSupportCost?: string;
  note?: string | null;
}

export interface DistributionMemberCalculation {
  memberId: number;
  participationShare: string;
  allianceShare: string;
  participationAmount: string;
  allianceAmount: string;
  supportTotal: string;
  finalDiamonds: string;
  payableDiamonds: string;
  roundingAdjustment: string;
  cashAmount: string;
}

export interface DistributionCalculation {
  members: DistributionMemberCalculation[];
  totals: DistributionCalculationTotals;
}

export interface DistributionListFilters {
  status?: DistributionStatus;
  startDate?: string;
  endDate?: string;
}
