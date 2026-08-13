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

export interface VoteParticipantDetail extends VoteParticipant {
  voteKey: string;
  joinedAt: string;
}

export interface VoteMember {
  userId: number;
  nickname: string;
  role: UserRole;
}

export interface VoteBoss {
  id: number | null;
  voteKey: string;
  type: string;
  region: string;
  boss: string;
  spawnTime: number;
  participants: VoteParticipant[];
  participantCount: number;
  joined: boolean;
  isClosed: boolean;
  isBlessed: boolean;
  isManual: boolean;
  isHistory: boolean;
  isFixed: boolean;
}

export interface VoteStatisticsBoss {
  voteKey: string;
  dateKey: string;
  boss: string;
  spawnTime: number;
  type: string;
  region: string;
  isManual: boolean;
  isBlessed: boolean;
  participants: Array<VoteParticipant & { joinedAt: string }>;
  participantCount: number;
}

export interface VoteStatistics {
  month: string;
  totalBosses: number;
  totalParticipants: number;
  days: Array<{
    date: string;
    bosses: VoteStatisticsBoss[];
    totalParticipants: number;
  }>;
}

export interface VoteMemberRates {
  start: string;
  end: string;
  totalBosses: number;
  memberCount: number;
  members: Array<
    VoteMember & {
      joinedCount: number;
      missedCount: number;
      rate: number;
    }
  >;
}
