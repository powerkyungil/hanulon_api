import type { UserRole } from '../auth/auth.types';

export interface BossActor {
  id: number;
  guildId: number;
  role: UserRole;
  isActive: boolean;
}

export interface BossDefinition {
  id: number;
  guildId: number;
  type: string;
  region: string;
  boss: string;
  cooldownHours: number;
  timeText: string | null;
  days: string | null;
  color: string | null;
  sortOrder: number;
}

export interface BossDefinitionInput {
  type: string;
  region: string;
  boss: string;
  cooldownHours: number;
  timeText: string | null;
  days: string | null;
  color: string | null;
}

export interface BossKey {
  type: string;
  region: string;
  boss: string;
}
