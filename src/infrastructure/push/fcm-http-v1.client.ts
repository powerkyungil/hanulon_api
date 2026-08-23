import { createSign } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { AppConfig } from '../../config/env';
import type {
  PushMessage,
  PushSender,
  PushSendResult,
} from '../../modules/push-notifications/push-notifications.types';

export interface FirebaseServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface OAuthTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface FcmErrorResponse {
  error?: {
    status?: string;
    details?: Array<{ errorCode?: string }>;
  };
}

const REQUEST_TIMEOUT_MS = 15_000;

const encodeBase64Url = (value: string): string => Buffer.from(value).toString('base64url');

const parseServiceAccount = (raw: string): FirebaseServiceAccount => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('FCM service account JSON is invalid');
  }
  const account = parsed as Partial<FirebaseServiceAccount>;
  if (!account.project_id || !account.client_email || !account.private_key) {
    throw new Error('FCM service account requires project_id, client_email, and private_key');
  }
  return account as FirebaseServiceAccount;
};

export const loadFirebaseServiceAccount = (config: AppConfig): FirebaseServiceAccount => {
  if (config.fcmServiceAccountJson) return parseServiceAccount(config.fcmServiceAccountJson);
  if (!config.fcmServiceAccountFile) {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON or FCM_SERVICE_ACCOUNT_FILE must be set');
  }
  const filePath = path.resolve(config.fcmServiceAccountFile);
  return parseServiceAccount(fs.readFileSync(filePath, 'utf8'));
};

export class FcmHttpV1Client implements PushSender {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  public constructor(
    private readonly account: FirebaseServiceAccount,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  public async send(message: PushMessage): Promise<PushSendResult> {
    const accessToken = await this.getAccessToken();
    const response = await this.fetchImplementation(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.account.project_id)}/messages:send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: message.token,
            notification: { title: message.title, body: message.body },
            data: message.data,
            android: {
              priority: 'high',
              notification: { channel_id: 'boss_schedule_alerts' },
            },
          },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    const body = (await response.json().catch(() => ({}))) as FcmErrorResponse & { name?: string };
    if (response.ok) return { messageId: body.name };

    const detailCode = body.error?.details?.find((detail) => detail.errorCode)?.errorCode;
    const errorCode = detailCode ?? body.error?.status ?? `FCM_HTTP_${response.status}`;
    return {
      errorCode,
      invalidToken: detailCode === 'UNREGISTERED',
    };
  }

  private async getAccessToken(): Promise<string> {
    const nowMs = Date.now();
    if (this.accessToken && nowMs < this.accessTokenExpiresAt - 60_000) return this.accessToken;

    const tokenUri = this.account.token_uri || 'https://oauth2.googleapis.com/token';
    const nowSeconds = Math.floor(nowMs / 1000);
    const header = encodeBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = encodeBase64Url(
      JSON.stringify({
        iss: this.account.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: tokenUri,
        iat: nowSeconds,
        exp: nowSeconds + 3600,
      }),
    );
    const unsigned = `${header}.${claims}`;
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    signer.end();
    const assertion = `${unsigned}.${signer.sign(this.account.private_key, 'base64url')}`;

    const response = await this.fetchImplementation(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => ({}))) as OAuthTokenResponse;
    if (!response.ok || !body.access_token) {
      const error = new Error(`FCM OAuth failed: ${body.error ?? response.status}`);
      error.name = 'FCM_OAUTH_FAILED';
      throw error;
    }
    this.accessToken = body.access_token;
    this.accessTokenExpiresAt = nowMs + (body.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }
}
