import type { UserRole } from '../auth/auth.types';

export interface SiegeActor {
  id: number;
  guildId: number;
  role: UserRole;
  isActive: boolean;
}

export interface SiegeRecord {
  userId: number;
  nickname: string;
  mainClass: string;
  combatPower: number;
  currentDiamonds: number;
  remainingDiamonds: number;
  updatedAt: number | null;
}

export interface SiegeInput {
  currentDiamonds: number;
  remainingDiamonds: number;
}

export interface StoredSiegeRecord {
  currentDiamonds: number;
  remainingDiamonds: number;
}
