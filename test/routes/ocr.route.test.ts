import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app';
import { createTestConfig } from '../helpers/test-config';

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

const profileFor = (username: string) => ({
  username,
  password: 'strong-password',
  nickname: username,
  occupation: '프리스트',
  main_class: '세인트',
  combat_power: 120000,
  equipment: {},
  skills: { active: {}, passive: {} },
});

const login = async (app: Awaited<ReturnType<typeof buildApp>>, username: string) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username, password: 'strong-password' },
  });
  return (response.json() as { token: string }).token;
};

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('OCR routes', () => {
  it('keeps OCR credentials server-side and supports legacy raw-image requests', async () => {
    const config = createTestConfig();
    config.ocrInvokeUrl = 'https://ocr.example.test/invoke';
    config.ocrSecret = 'server-only-secret';
    config.ocrTemplates = [{ id: 123, name: '월드 보스' }];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: 'V2', images: [{ uid: 'result-id' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const app = await buildApp(config, { logger: false });
    openApps.push(app);
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { mode: 'CREATE_GUILD', guild_name: 'OCR 길드', ...profileFor('ocrowner') },
    });
    expect(registered.statusCode).toBe(201);
    const token = await login(app, 'ocrowner');
    const headers = { authorization: `Bearer ${token}` };

    const templates = await app.inject({
      method: 'GET',
      url: '/api/ocr/templates',
      headers,
    });
    expect(templates.json()).toEqual({ templates: [{ id: 123, name: '월드 보스' }] });
    expect(JSON.stringify(templates.json())).not.toContain(config.ocrSecret);

    const analyzed = await app.inject({
      method: 'POST',
      url: '/api/ocr/boss-schedule',
      headers: {
        ...headers,
        'content-type': 'image/png',
        'x-ocr-template-id': '123',
      },
      payload: Buffer.from([137, 80, 78, 71]),
    });
    expect(analyzed.statusCode).toBe(200);
    expect(analyzed.json()).toEqual({ version: 'V2', images: [{ uid: 'result-id' }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toEqual({ 'X-OCR-SECRET': config.ocrSecret });
  });

  it('allows only the current database master and reports missing configuration', async () => {
    const app = await buildApp(createTestConfig(), { logger: false });
    openApps.push(app);
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { mode: 'CREATE_GUILD', guild_name: 'OCR 권한 길드', ...profileFor('ocrrole') },
    });
    const userId = (registered.json() as { data: { userId: number } }).data.userId;
    const token = await login(app, 'ocrrole');
    const headers = { authorization: `Bearer ${token}` };

    app.db.prepare("UPDATE users SET role = 'ADMIN' WHERE id = ?").run(userId);
    const denied = await app.inject({ method: 'GET', url: '/api/ocr/templates', headers });
    expect(denied.statusCode).toBe(403);

    app.db.prepare("UPDATE users SET role = 'MASTER' WHERE id = ?").run(userId);
    const missing = await app.inject({
      method: 'POST',
      url: '/api/ocr/boss-schedule',
      headers: {
        ...headers,
        'content-type': 'image/jpeg',
        'x-ocr-template-id': '1',
      },
      payload: Buffer.from([255, 216]),
    });
    expect(missing.statusCode).toBe(503);
    expect(missing.json()).toMatchObject({ code: 'OCR_NOT_CONFIGURED' });
  });
});
