CREATE TABLE boss_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    region TEXT NOT NULL,
    boss TEXT NOT NULL,
    cooldown_hours REAL NOT NULL DEFAULT 0 CHECK (cooldown_hours BETWEEN 0 AND 1000),
    time_text TEXT,
    days TEXT,
    color TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_boss_definitions_guild_order
    ON boss_definitions (guild_id, sort_order, id);

CREATE TABLE boss_definition_seed_state (
    guild_id INTEGER PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
    seeded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE boss_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    boss_definition_id INTEGER NOT NULL REFERENCES boss_definitions(id) ON DELETE CASCADE,
    spawn_time INTEGER NOT NULL CHECK (spawn_time >= 0),
    is_mung INTEGER NOT NULL DEFAULT 0 CHECK (is_mung IN (0, 1)),
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guild_id, boss_definition_id)
);

CREATE INDEX idx_boss_schedules_guild_spawn
    ON boss_schedules (guild_id, spawn_time, id);

CREATE TABLE schedule_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    boss_definition_id INTEGER,
    type TEXT NOT NULL,
    region TEXT NOT NULL,
    boss TEXT NOT NULL,
    spawn_time INTEGER NOT NULL,
    is_mung INTEGER NOT NULL CHECK (is_mung IN (0, 1)),
    created_by INTEGER NOT NULL,
    recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guild_id, type, region, boss, spawn_time)
);

CREATE INDEX idx_schedule_history_guild_spawn
    ON schedule_history (guild_id, spawn_time DESC);

CREATE TRIGGER archive_boss_schedule_after_insert
AFTER INSERT ON boss_schedules
BEGIN
    INSERT OR IGNORE INTO schedule_history (
        guild_id,
        boss_definition_id,
        type,
        region,
        boss,
        spawn_time,
        is_mung,
        created_by
    )
    SELECT
        NEW.guild_id,
        NEW.boss_definition_id,
        bd.type,
        bd.region,
        bd.boss,
        NEW.spawn_time,
        NEW.is_mung,
        NEW.created_by
    FROM boss_definitions AS bd
    WHERE bd.id = NEW.boss_definition_id AND bd.guild_id = NEW.guild_id;
END;

CREATE TABLE participation_targets (
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    boss TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, boss)
);

CREATE TABLE boss_participants (
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    vote_key TEXT NOT NULL,
    boss TEXT NOT NULL,
    spawn_time INTEGER NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname_snapshot TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, vote_key, user_id)
);

CREATE INDEX idx_boss_participants_guild_spawn
    ON boss_participants (guild_id, spawn_time, created_at);

CREATE TABLE participation_states (
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    vote_key TEXT NOT NULL,
    spawn_time INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'INACTIVE', 'DELETED')),
    updated_by INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, vote_key)
);

CREATE INDEX idx_participation_states_guild_spawn
    ON participation_states (guild_id, spawn_time, state);

CREATE TABLE boss_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    actor_user_id INTEGER NOT NULL,
    boss_definition_id INTEGER,
    action TEXT NOT NULL CHECK (
        action IN ('BOSS_CREATED', 'BOSS_DELETED', 'BOSSES_REORDERED', 'BOSSES_RESET')
    ),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_boss_audit_logs_guild_created
    ON boss_audit_logs (guild_id, created_at DESC, id DESC);

CREATE TABLE schedule_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    actor_user_id INTEGER NOT NULL,
    schedule_id INTEGER,
    action TEXT NOT NULL CHECK (
        action IN ('SCHEDULES_SAVED', 'SCHEDULE_CUT', 'SCHEDULE_MUNG', 'SCHEDULE_DELETED', 'SCHEDULES_RESET', 'TARGETS_CHANGED', 'PARTICIPATION_TOGGLED')
    ),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_schedule_audit_logs_guild_created
    ON schedule_audit_logs (guild_id, created_at DESC, id DESC);
