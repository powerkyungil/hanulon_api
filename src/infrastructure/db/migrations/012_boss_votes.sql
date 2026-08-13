CREATE TABLE manual_boss_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    region TEXT NOT NULL,
    boss TEXT NOT NULL,
    spawn_time INTEGER NOT NULL CHECK (spawn_time >= 0),
    is_blessed INTEGER NOT NULL DEFAULT 0 CHECK (is_blessed IN (0, 1)),
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guild_id, type, region, boss, spawn_time)
);

CREATE INDEX idx_manual_boss_votes_guild_spawn
    ON manual_boss_votes (guild_id, spawn_time, id);

CREATE TABLE boss_vote_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    actor_user_id INTEGER NOT NULL,
    vote_key TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('MANUAL_VOTE_CREATED', 'PARTICIPATION_TOGGLED')),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_boss_vote_audit_logs_guild_created
    ON boss_vote_audit_logs (guild_id, created_at DESC, id DESC);
