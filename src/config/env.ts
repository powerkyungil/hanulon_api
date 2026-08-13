import path from 'node:path';

import dotenv from 'dotenv';

dotenv.config();

export type NodeEnvironment = 'development' | 'test' | 'production';

export interface AppConfig {
  nodeEnv: NodeEnvironment;
  host: string;
  port: number;
  jwtSecret: string;
  databasePath: string;
  corsOrigins: string[];
  logLevel: string;
  bossHistoryRetentionDays: number;
}

const parseNodeEnvironment = (value: string | undefined): NodeEnvironment => {
  if (value === 'production' || value === 'test') return value;
  return 'development';
};

const parsePositiveInteger = (
  value: string | undefined,
  fallback: number,
  name: string,
): number => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
};

const parseCorsOrigins = (value: string | undefined): string[] => {
  if (!value || value.trim() === '') return [];
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

export const loadConfig = (source: NodeJS.ProcessEnv = process.env): AppConfig => {
  const nodeEnv = parseNodeEnvironment(source.NODE_ENV);
  const jwtSecret = source.JWT_SECRET?.trim() ?? '';

  if (nodeEnv === 'production' && jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters in production');
  }

  if (nodeEnv !== 'production' && jwtSecret.length === 0) {
    throw new Error('JWT_SECRET must be set for development and test environments');
  }

  return {
    nodeEnv,
    host: source.HOST?.trim() || '127.0.0.1',
    port: parsePositiveInteger(source.PORT, 3001, 'PORT'),
    jwtSecret,
    databasePath: path.resolve(source.DB_PATH?.trim() || './data/odin-guild.sqlite'),
    corsOrigins: parseCorsOrigins(source.CORS_ORIGINS),
    logLevel: source.LOG_LEVEL?.trim() || 'info',
    bossHistoryRetentionDays: parsePositiveInteger(
      source.BOSS_HISTORY_RETENTION_DAYS,
      90,
      'BOSS_HISTORY_RETENTION_DAYS',
    ),
  };
};
