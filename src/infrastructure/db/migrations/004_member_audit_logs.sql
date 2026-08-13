CREATE TABLE member_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    actor_user_id INTEGER NOT NULL,
    target_user_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (
        action IN ('ROLE_CHANGED', 'MASTER_TRANSFERRED', 'PASSWORD_RESET', 'MEMBER_REMOVED')
    ),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_member_audit_logs_guild_created
    ON member_audit_logs (guild_id, created_at);
