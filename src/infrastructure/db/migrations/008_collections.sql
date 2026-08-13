CREATE TABLE collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guild_id, name COLLATE NOCASE)
);

CREATE INDEX idx_collections_guild
    ON collections (guild_id, id);

CREATE TABLE collection_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    part TEXT NOT NULL,
    enchantment TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (collection_id, sort_order)
);

CREATE INDEX idx_collection_items_collection_order
    ON collection_items (collection_id, sort_order, id);

CREATE TABLE user_collection_items (
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    collection_item_id INTEGER NOT NULL REFERENCES collection_items(id) ON DELETE CASCADE,
    completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, user_id, collection_item_id)
);

CREATE INDEX idx_user_collection_items_guild_item
    ON user_collection_items (guild_id, collection_item_id, user_id);

CREATE TABLE excluded_members (
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE collection_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    actor_user_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (
        action IN (
            'COLLECTION_CREATED',
            'COLLECTION_UPDATED',
            'COLLECTION_DELETED',
            'COMPLETION_CHANGED',
            'EXCLUSION_CHANGED'
        )
    ),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_collection_audit_logs_guild_created
    ON collection_audit_logs (guild_id, created_at);
