DROP INDEX idx_deputy_account_audit_logs_guild_created;

ALTER TABLE deputy_account_audit_logs RENAME TO deputy_account_audit_logs_legacy;

CREATE TABLE deputy_account_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_deputy_id INTEGER REFERENCES deputy_accounts(id) ON DELETE SET NULL,
    deputy_account_id INTEGER REFERENCES deputy_accounts(id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK (
        action IN (
            'ACCOUNT_CREATED',
            'PASSWORD_RESET',
            'ACCOUNT_ACTIVATED',
            'ACCOUNT_DEACTIVATED',
            'CHARACTER_SELECTED',
            'NICKNAME_UPDATED'
        )
    ),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO deputy_account_audit_logs (
    id, guild_id, actor_user_id, actor_deputy_id, deputy_account_id, action, metadata_json, created_at
)
SELECT
    id, guild_id, actor_user_id, actor_deputy_id, deputy_account_id, action, metadata_json, created_at
FROM deputy_account_audit_logs_legacy;

DROP TABLE deputy_account_audit_logs_legacy;

CREATE INDEX idx_deputy_account_audit_logs_guild_created
    ON deputy_account_audit_logs (guild_id, created_at DESC, id DESC);
