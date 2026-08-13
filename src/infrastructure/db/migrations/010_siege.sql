CREATE TABLE siege_records (
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    current_diamonds INTEGER NOT NULL DEFAULT 0 CHECK (
        current_diamonds BETWEEN 0 AND 999999999
    ),
    remaining_diamonds INTEGER NOT NULL DEFAULT 0 CHECK (
        remaining_diamonds BETWEEN 0 AND 999999999
        AND remaining_diamonds <= current_diamonds
    ),
    updated_by INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX idx_siege_records_guild_updated
    ON siege_records (guild_id, updated_at DESC);

CREATE TABLE siege_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    actor_user_id INTEGER NOT NULL,
    target_user_id INTEGER,
    action TEXT NOT NULL CHECK (action IN ('RECORD_UPDATED', 'ALL_RESET')),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_siege_audit_logs_guild_created
    ON siege_audit_logs (guild_id, created_at DESC, id DESC);
