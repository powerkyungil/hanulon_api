import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app';
import { createTestConfig } from '../helpers/test-config';

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('system routes', () => {
  it('returns server epoch time and the guild timezone', async () => {
    const app = await buildApp(createTestConfig(), { logger: false });
    openApps.push(app);

    const before = Date.now();
    const response = await app.inject({ method: 'GET', url: '/api/v1/time' });
    const after = Date.now();
    const body = response.json() as { data: { epochMs: number; timeZone: string } };

    expect(response.statusCode).toBe(200);
    expect(body.data.timeZone).toBe('Asia/Seoul');
    expect(body.data.epochMs).toBeGreaterThanOrEqual(before);
    expect(body.data.epochMs).toBeLessThanOrEqual(after);
  });
});
