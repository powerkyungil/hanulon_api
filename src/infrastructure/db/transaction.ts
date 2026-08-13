import type Database from 'better-sqlite3';

export const withTransaction = <T>(db: Database.Database, operation: () => T): T =>
  db.transaction(operation)();
