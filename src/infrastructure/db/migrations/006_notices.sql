CREATE TABLE notice_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#F8FAFC',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notice_rules_guild_order
    ON notice_rules (guild_id, sort_order, id);

CREATE TABLE price_guides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#F8FAFC',
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_price_guides_guild_updated
    ON price_guides (guild_id, updated_at DESC, id DESC);

CREATE TABLE boss_controls (
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    chapter TEXT NOT NULL,
    boss TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'NONE' CHECK (status IN ('NONE', 'ALLY_ONLY', 'CONTROL')),
    updated_by INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, chapter, boss)
);

CREATE INDEX idx_boss_controls_guild
    ON boss_controls (guild_id);

CREATE TABLE notice_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    actor_user_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (
        action IN (
            'ARTICLE_CREATED',
            'ARTICLE_UPDATED',
            'ARTICLE_DELETED',
            'RULES_REORDERED',
            'BOSS_CONTROL_UPDATED'
        )
    ),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notice_audit_logs_guild_created
    ON notice_audit_logs (guild_id, created_at);
