import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app';
import { createTestConfig } from '../helpers/test-config';

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('health routes', () => {
  it('returns a live response without requiring authentication', async () => {
    const app = await buildApp(createTestConfig(), { logger: false });
    openApps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { status: 'ok' } });
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('reports the database and applied migrations as ready', async () => {
    const app = await buildApp(createTestConfig(), { logger: false });
    openApps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        status: 'ready',
        database: 'ok',
        migrationsApplied: 17,
      },
    });
  });
});
