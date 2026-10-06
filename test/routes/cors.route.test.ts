import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app';
import { createTestConfig } from '../helpers/test-config';

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('browser CORS preflight', () => {
  it('allows an authenticated PUT to reset a member password', async () => {
    const origin = 'https://web.example.test';
    const app = await buildApp({ ...createTestConfig(), corsOrigins: [origin] }, { logger: false });
    openApps.push(app);

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/members/42/password-reset',
      headers: {
        origin,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'authorization',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-methods']).toContain('PUT');
    expect(response.headers['access-control-allow-headers']).toContain('authorization');
  });
});
