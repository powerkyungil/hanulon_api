DELETE FROM invites
WHERE id NOT IN (
    SELECT MAX(id)
    FROM invites
    GROUP BY guild_id, role
);

CREATE UNIQUE INDEX idx_invites_guild_role_unique
    ON invites (guild_id, role);

CREATE TABLE guild_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    actor_user_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('SETTINGS_UPDATED', 'INVITE_REPLACED')),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_guild_audit_logs_guild_created
    ON guild_audit_logs (guild_id, created_at);
