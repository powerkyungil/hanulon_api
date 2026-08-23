import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  FcmHttpV1Client,
  type FirebaseServiceAccount,
} from '../../src/infrastructure/push/fcm-http-v1.client';

const createAccount = (): FirebaseServiceAccount => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    project_id: 'odin-test-project',
    client_email: 'push@odin-test-project.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    token_uri: 'https://oauth.example.test/token',
  };
};

const message = {
  token: 'fcm-registration-token-000001',
  title: '파르바 출현 5분 전',
  body: '[미드가르드] 파르바 5분 후 출현합니다.',
  data: { type: 'BOSS_SCHEDULE' },
};

describe('FcmHttpV1Client', () => {
  it('exchanges a signed service-account assertion and caches the OAuth access token', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/token')) {
        return new Response(JSON.stringify({ access_token: 'access-token', expires_in: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ name: 'projects/odin-test/messages/1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const client = new FcmHttpV1Client(createAccount(), fetchMock);

    expect(await client.send(message)).toEqual({ messageId: 'projects/odin-test/messages/1' });
    expect(await client.send(message)).toEqual({ messageId: 'projects/odin-test/messages/1' });
    expect(requests.filter(({ url }) => url.endsWith('/token'))).toHaveLength(1);
    expect(requests.filter(({ url }) => url.includes('messages:send'))).toHaveLength(2);
    expect(requests[1].init?.headers).toMatchObject({ authorization: 'Bearer access-token' });
    expect(JSON.parse(String(requests[1].init?.body))).toMatchObject({
      message: {
        token: message.token,
        android: { priority: 'high', notification: { channel_id: 'boss_schedule_alerts' } },
      },
    });
  });

  it('marks FCM UNREGISTERED responses as invalid tokens', async () => {
    const fetchMock: typeof fetch = async (input) => {
      if (String(input).endsWith('/token')) {
        return new Response(JSON.stringify({ access_token: 'access-token', expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          error: {
            status: 'NOT_FOUND',
            details: [{ errorCode: 'UNREGISTERED' }],
          },
        }),
        { status: 404 },
      );
    };
    const client = new FcmHttpV1Client(createAccount(), fetchMock);

    expect(await client.send(message)).toEqual({
      errorCode: 'UNREGISTERED',
      invalidToken: true,
    });
  });
});
