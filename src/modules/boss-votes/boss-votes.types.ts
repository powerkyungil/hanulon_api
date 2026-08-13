import type { UserRole } from '../auth/auth.types';

export interface VoteActor {
  id: number;
  guildId: number;
  role: UserRole;
  nickname: string;
  isActive: boolean;
}

export interface ManualVoteInput {
  type: string;
  region: string;
  boss: string;
  spawnTime: number;
  isBlessed: boolean;
}

export interface ManualVote extends ManualVoteInput {
  id: number;
}

export interface VoteParticipant {
  userId: number;
  nickname: string;
}

export interface VoteBoss {
  id: number | null;
  voteKey: string;
  type: string;
  region: string;
  boss: string;
  spawnTime: number;
  participants: VoteParticipant[];
  joined: boolean;
  isClosed: boolean;
  isBlessed: boolean;
  isManual: boolean;
  isHistory: boolean;
}
