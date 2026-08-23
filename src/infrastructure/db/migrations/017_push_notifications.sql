CREATE TABLE push_device_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    platform TEXT NOT NULL CHECK (platform IN ('ANDROID')),
    device_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, device_id)
);

CREATE INDEX idx_push_device_tokens_guild_user
    ON push_device_tokens (guild_id, user_id, id);

CREATE TABLE push_delivery_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    boss_definition_id INTEGER NOT NULL,
    schedule_id INTEGER,
    spawn_time INTEGER NOT NULL,
    lead_seconds INTEGER NOT NULL CHECK (lead_seconds IN (300, 60, 0)),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_token_id INTEGER NOT NULL,
    device_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'SENT', 'FAILED')),
    attempt_count INTEGER NOT NULL DEFAULT 1,
    claim_expires_at INTEGER,
    next_retry_at INTEGER,
    sent_at INTEGER,
    last_error_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guild_id, boss_definition_id, spawn_time, lead_seconds, device_key)
);

CREATE INDEX idx_push_delivery_history_retry
    ON push_delivery_history (status, next_retry_at, claim_expires_at);

CREATE INDEX idx_push_delivery_history_guild_spawn
    ON push_delivery_history (guild_id, spawn_time, lead_seconds);
