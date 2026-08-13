CREATE TABLE content_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guild_id, name COLLATE NOCASE)
);

CREATE INDEX idx_content_groups_guild
    ON content_groups (guild_id, id);

CREATE TABLE group_members (
    group_id INTEGER NOT NULL REFERENCES content_groups(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id),
    UNIQUE (user_id),
    UNIQUE (group_id, sort_order)
);

CREATE INDEX idx_group_members_group_order
    ON group_members (group_id, sort_order, user_id);

CREATE TABLE content_group_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    actor_user_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (
        action IN ('GROUP_CREATED', 'GROUP_RENAMED', 'GROUP_DELETED', 'MEMBERS_REPLACED')
    ),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_content_group_audit_logs_guild_created
    ON content_group_audit_logs (guild_id, created_at);
