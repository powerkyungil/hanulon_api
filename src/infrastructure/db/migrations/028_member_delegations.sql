CREATE TABLE member_delegations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    deputy_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TEXT,
    CHECK (owner_user_id <> deputy_user_id),
    UNIQUE (guild_id, owner_user_id, deputy_user_id)
);

CREATE INDEX idx_member_delegations_owner_active
    ON member_delegations (guild_id, owner_user_id, is_active, id);

CREATE INDEX idx_member_delegations_deputy_active
    ON member_delegations (guild_id, deputy_user_id, is_active, id);

CREATE TABLE member_delegation_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    actor_user_id INTEGER NOT NULL,
    owner_user_id INTEGER NOT NULL,
    deputy_user_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('DELEGATION_GRANTED', 'DELEGATION_REVOKED')),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_member_delegation_audit_logs_guild_created
    ON member_delegation_audit_logs (guild_id, created_at DESC, id DESC);

ALTER TABLE support_requests
    ADD COLUMN actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE support_applications
    ADD COLUMN actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
