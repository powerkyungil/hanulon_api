import type { UserRole } from '../auth/auth.types';

export interface ScheduleActor {
  id: number;
  guildId: number;
  role: UserRole;
  nickname: string;
  isActive: boolean;
  deputyId?: number;
  actorNickname?: string;
}

export interface BossSchedule {
  id: number;
  bossDefinitionId: number;
  type: string;
  region: string;
  boss: string;
  spawnTime: number;
  isMung: boolean;
}

export interface ScheduleInput {
  bossDefinitionId?: number;
  type: string;
  region: string;
  boss: string;
  spawnTime: number;
}

export interface ResolvedScheduleInput extends ScheduleInput {
  bossDefinitionId: number;
}

export interface ParticipationToggleInput extends ScheduleInput {
  characterKey?: string;
}

export interface VoteOccurrence {
  id: number | null;
  type: string;
  region: string;
  boss: string;
  spawnTime: number;
  isFixed: boolean;
  isHistory: boolean;
}
