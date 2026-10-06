CREATE TABLE deputy_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    username TEXT NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    nickname TEXT NOT NULL,
    active_character_key TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    token_version INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guild_id, username)
);

CREATE INDEX idx_deputy_accounts_guild_active
    ON deputy_accounts (guild_id, is_active, id);

CREATE TABLE deputy_account_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_deputy_id INTEGER REFERENCES deputy_accounts(id) ON DELETE SET NULL,
    deputy_account_id INTEGER REFERENCES deputy_accounts(id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK (
        action IN ('ACCOUNT_CREATED', 'PASSWORD_RESET', 'ACCOUNT_ACTIVATED', 'ACCOUNT_DEACTIVATED', 'CHARACTER_SELECTED')
    ),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_deputy_account_audit_logs_guild_created
    ON deputy_account_audit_logs (guild_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX idx_deputy_accounts_username_global
    ON deputy_accounts (username COLLATE NOCASE);

CREATE TRIGGER prevent_user_username_matching_deputy_insert
BEFORE INSERT ON users
WHEN EXISTS (
    SELECT 1 FROM deputy_accounts WHERE username = NEW.username COLLATE NOCASE
)
BEGIN
    SELECT RAISE(ABORT, 'USERNAME_EXISTS');
END;

CREATE TRIGGER prevent_user_username_matching_deputy_update
BEFORE UPDATE OF username ON users
WHEN EXISTS (
    SELECT 1 FROM deputy_accounts WHERE username = NEW.username COLLATE NOCASE
)
BEGIN
    SELECT RAISE(ABORT, 'USERNAME_EXISTS');
END;

CREATE TRIGGER prevent_deputy_username_matching_user_insert
BEFORE INSERT ON deputy_accounts
WHEN EXISTS (
    SELECT 1 FROM users WHERE username = NEW.username COLLATE NOCASE
)
BEGIN
    SELECT RAISE(ABORT, 'USERNAME_EXISTS');
END;

CREATE TRIGGER prevent_deputy_username_matching_user_update
BEFORE UPDATE OF username ON deputy_accounts
WHEN EXISTS (
    SELECT 1 FROM users WHERE username = NEW.username COLLATE NOCASE
)
BEGIN
    SELECT RAISE(ABORT, 'USERNAME_EXISTS');
END;

ALTER TABLE boss_participants RENAME TO boss_participants_legacy;

CREATE TABLE boss_participants (
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    vote_key TEXT NOT NULL,
    boss TEXT NOT NULL,
    spawn_time INTEGER NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    character_type TEXT NOT NULL DEFAULT 'MAIN' CHECK (character_type IN ('MAIN', 'ALTERNATE')),
    character_name_snapshot TEXT NOT NULL DEFAULT '',
    nickname_snapshot TEXT NOT NULL,
    actor_type TEXT NOT NULL DEFAULT 'USER' CHECK (actor_type IN ('USER', 'DEPUTY')),
    actor_id INTEGER,
    actor_nickname_snapshot TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, vote_key, user_id, character_type)
);

INSERT INTO boss_participants (
    guild_id,
    vote_key,
    boss,
    spawn_time,
    user_id,
    character_type,
    character_name_snapshot,
    nickname_snapshot,
    actor_type,
    actor_id,
    actor_nickname_snapshot,
    created_at
)
SELECT
    guild_id,
    vote_key,
    boss,
    spawn_time,
    user_id,
    'MAIN',
    nickname_snapshot,
    nickname_snapshot,
    'USER',
    user_id,
    nickname_snapshot,
    created_at
FROM boss_participants_legacy;

DROP TABLE boss_participants_legacy;

CREATE INDEX idx_boss_participants_guild_spawn
    ON boss_participants (guild_id, spawn_time, created_at);

ALTER TABLE boss_vote_audit_logs
    ADD COLUMN actor_deputy_id INTEGER REFERENCES deputy_accounts(id) ON DELETE SET NULL;

ALTER TABLE schedule_audit_logs
    ADD COLUMN actor_deputy_id INTEGER REFERENCES deputy_accounts(id) ON DELETE SET NULL;

ALTER TABLE support_requests
    ADD COLUMN requester_character_type TEXT NOT NULL DEFAULT 'MAIN'
        CHECK (requester_character_type IN ('MAIN', 'ALTERNATE'));
ALTER TABLE support_requests
    ADD COLUMN actor_deputy_id INTEGER REFERENCES deputy_accounts(id) ON DELETE SET NULL;

ALTER TABLE support_applications
    ADD COLUMN applicant_character_type TEXT NOT NULL DEFAULT 'MAIN'
        CHECK (applicant_character_type IN ('MAIN', 'ALTERNATE'));
ALTER TABLE support_applications
    ADD COLUMN actor_deputy_id INTEGER REFERENCES deputy_accounts(id) ON DELETE SET NULL;

ALTER TABLE support_audit_logs
    ADD COLUMN actor_deputy_id INTEGER REFERENCES deputy_accounts(id) ON DELETE SET NULL;
