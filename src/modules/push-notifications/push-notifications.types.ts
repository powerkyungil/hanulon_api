export interface PushTokenActor {
  id: number;
  guildId: number;
  isActive: boolean;
}

export interface RegisterPushTokenInput {
  token: string;
  platform: 'ANDROID';
  deviceId?: string;
}

export interface RegisteredPushToken {
  id: number;
  platform: 'ANDROID';
  deviceId: string | null;
  updatedAt: number;
}

export type BossNotificationLeadSeconds = 300 | 60 | 0;

export interface BossPushCandidate {
  guildId: number;
  scheduleId: number | null;
  bossDefinitionId: number;
  type: string;
  region: string;
  boss: string;
  spawnTime: number;
  leadSeconds: BossNotificationLeadSeconds;
  userId: number;
  deviceTokenId: number;
  deviceKey: string;
  token: string;
}

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface PushSendResult {
  messageId?: string;
  invalidToken?: boolean;
  errorCode?: string;
}

export interface PushSender {
  send(message: PushMessage): Promise<PushSendResult>;
}

export interface BossPushRunResult {
  candidates: number;
  sent: number;
  failed: number;
  invalidTokensRemoved: number;
  skipped: number;
}
