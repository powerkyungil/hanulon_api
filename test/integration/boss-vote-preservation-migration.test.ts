import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

const openDatabases: Database.Database[] = [];

afterEach(() => {
  openDatabases.splice(0).forEach((db) => db.close());
});

describe('vote preservation migration', () => {
  it('keeps existing targets, vote history, participation, and visibility', () => {
    const db = new Database(':memory:');
    openDatabases.push(db);
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE guilds (id INTEGER PRIMARY KEY);
      CREATE TABLE boss_definitions (
        id INTEGER PRIMARY KEY,
        guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        region TEXT NOT NULL,
        boss TEXT NOT NULL
      );
      CREATE TABLE participation_targets (
        guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        boss_definition_id INTEGER NOT NULL REFERENCES boss_definitions(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (guild_id, boss_definition_id)
      );
      CREATE TABLE schedule_history (
        id INTEGER PRIMARY KEY,
        guild_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        region TEXT NOT NULL,
        boss TEXT NOT NULL,
        spawn_time INTEGER NOT NULL,
        recorded_at TEXT NOT NULL,
        vote_hidden INTEGER NOT NULL
      );
      CREATE TABLE boss_participants (
        guild_id INTEGER NOT NULL,
        vote_key TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        nickname_snapshot TEXT NOT NULL
      );
      CREATE TABLE participation_states (
        guild_id INTEGER NOT NULL,
        vote_key TEXT NOT NULL,
        state TEXT NOT NULL
      );
      INSERT INTO guilds (id) VALUES (7);
      INSERT INTO boss_definitions (id, guild_id, type, region, boss)
        VALUES (31, 7, '본섭', '요툰하임', '파르바');
      INSERT INTO participation_targets (guild_id, boss_definition_id, created_at)
        VALUES (7, 31, '2026-09-01 00:00:00');
      INSERT INTO schedule_history (
        id, guild_id, type, region, boss, spawn_time, recorded_at, vote_hidden
      ) VALUES (41, 7, '본섭', '요툰하임', '파르바', 1789600000000, '2026-09-01 00:00:00', 1);
      INSERT INTO boss_participants (guild_id, vote_key, user_id, nickname_snapshot)
        VALUES (7, '본섭|요툰하임|파르바|1789600000000', 9, '참여자');
      INSERT INTO participation_states (guild_id, vote_key, state)
        VALUES (7, '본섭|요툰하임|파르바|1789600000000', 'INACTIVE');
    `);

    const migration = readFileSync(
      join(process.cwd(), 'src/infrastructure/db/migrations/025_participation_target_identity.sql'),
      'utf8',
    );
    db.exec(migration);

    expect(
      db.prepare('SELECT guild_id, type, region, boss FROM participation_targets').all(),
    ).toEqual([{ guild_id: 7, type: '본섭', region: '요툰하임', boss: '파르바' }]);
    expect(db.prepare('SELECT vote_hidden FROM schedule_history WHERE id = 41').get()).toEqual({
      vote_hidden: 0,
    });
    expect(db.prepare('SELECT vote_key FROM boss_participants WHERE guild_id = 7').get()).toEqual({
      vote_key: '본섭|요툰하임|파르바|1789600000000',
    });
    expect(db.prepare('SELECT state FROM participation_states WHERE guild_id = 7').get()).toEqual({
      state: 'INACTIVE',
    });
  });
});
