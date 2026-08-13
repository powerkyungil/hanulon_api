import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import type { AppConfig } from '../../config/env';
import { runMigrations } from './migration-runner';

export interface DatabaseContext {
  db: Database.Database;
  migrationsApplied: number;
}

export const openDatabase = (config: AppConfig): DatabaseContext => {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

  const db = new Database(config.databasePath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  const migrationsDirectory = path.resolve(__dirname, 'migrations');
  const migrationsApplied = runMigrations(db, migrationsDirectory);

  return { db, migrationsApplied };
};
