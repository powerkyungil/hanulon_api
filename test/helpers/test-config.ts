import os from 'node:os';
import path from 'node:path';

import type { AppConfig } from '../../src/config/env';

export const createTestConfig = (): AppConfig => ({
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 0,
  jwtSecret: 'test-secret-that-is-long-enough-for-jwt',
  jwtPreviousSecret: '',
  databasePath: path.join(
    os.tmpdir(),
    `odin-guild-api-test-${process.pid}-${Math.random().toString(36).slice(2)}.sqlite`,
  ),
  corsOrigins: [],
  logLevel: 'silent',
  bossHistoryRetentionDays: 90,
  ocrInvokeUrl: '',
  ocrSecret: '',
  ocrTemplates: [],
});
