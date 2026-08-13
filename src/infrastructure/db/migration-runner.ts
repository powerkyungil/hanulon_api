import fs from 'node:fs';
import path from 'node:path';

import type Database from 'better-sqlite3';

interface MigrationFile {
  version: string;
  filePath: string;
}

const listMigrationFiles = (directory: string): MigrationFile[] =>
  fs
    .readdirSync(directory)
    .filter((fileName) => /^\d+_.+\.sql$/.test(fileName))
    .sort()
    .map((fileName) => ({
      version: fileName.replace(/\.sql$/, ''),
      filePath: path.join(directory, fileName),
    }));

export const runMigrations = (db: Database.Database, directory: string): number => {
  const migrationFiles = listMigrationFiles(directory);
  const metadataMigration = migrationFiles[0];

  if (!metadataMigration || !metadataMigration.version.startsWith('000_')) {
    throw new Error('The first migration must create schema_migrations');
  }

  const migrationTableExists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();

  if (!migrationTableExists) {
    const sql = fs.readFileSync(metadataMigration.filePath, 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(
        metadataMigration.version,
      );
    })();
  }

  const appliedVersions = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => (row as { version: string }).version),
  );

  for (const migration of migrationFiles) {
    if (appliedVersions.has(migration.version)) continue;

    const sql = fs.readFileSync(migration.filePath, 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(migration.version);
    })();
    appliedVersions.add(migration.version);
  }

  return appliedVersions.size;
};
