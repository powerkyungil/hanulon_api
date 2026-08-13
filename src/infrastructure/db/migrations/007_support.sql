CREATE TABLE support_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_time TEXT NOT NULL,
    memo TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'MATCHED', 'DONE', 'CANCELED')),
    selected_application_id INTEGER REFERENCES support_applications(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_support_requests_guild_status_created
    ON support_requests (guild_id, status, created_at DESC);

CREATE TABLE support_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
    applicant_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    memo TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'APPLIED' CHECK (status IN ('APPLIED', 'SELECTED')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (request_id, applicant_id)
);

CREATE INDEX idx_support_applications_request_status
    ON support_applications (request_id, status, created_at);

CREATE UNIQUE INDEX idx_support_applications_selected_unique
    ON support_applications (request_id)
    WHERE status = 'SELECTED';

CREATE TABLE support_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    actor_user_id INTEGER NOT NULL,
    request_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (
        action IN (
            'REQUEST_CREATED',
            'REQUEST_STATUS_CHANGED',
            'REQUEST_DELETED',
            'APPLICATION_CREATED',
            'APPLICATION_CANCELED',
            'APPLICATION_SELECTED'
        )
    ),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_support_audit_logs_guild_created
    ON support_audit_logs (guild_id, created_at);
