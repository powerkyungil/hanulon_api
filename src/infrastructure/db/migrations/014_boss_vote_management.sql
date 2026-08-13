ALTER TABLE boss_vote_audit_logs RENAME TO boss_vote_audit_logs_old;

CREATE TABLE boss_vote_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    actor_user_id INTEGER NOT NULL,
    vote_key TEXT NOT NULL,
    action TEXT NOT NULL CHECK (
        action IN (
            'MANUAL_VOTE_CREATED',
            'MANUAL_VOTE_DELETED',
            'PARTICIPATION_TOGGLED',
            'PARTICIPANT_REMOVED',
            'VOTE_CLOSED',
            'VOTE_DELETED'
        )
    ),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO boss_vote_audit_logs (
    id,
    guild_id,
    actor_user_id,
    vote_key,
    action,
    metadata_json,
    created_at
)
SELECT
    id,
    guild_id,
    actor_user_id,
    vote_key,
    action,
    metadata_json,
    created_at
FROM boss_vote_audit_logs_old;

DROP TABLE boss_vote_audit_logs_old;

CREATE INDEX idx_boss_vote_audit_logs_guild_created
    ON boss_vote_audit_logs (guild_id, created_at DESC, id DESC);
