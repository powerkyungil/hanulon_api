CREATE TABLE guilds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO guilds (id, name)
SELECT 1, guild_name
FROM guild_settings
WHERE id = 1;

CREATE TABLE guild_settings_v2 (
    guild_id INTEGER PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
    guild_name TEXT NOT NULL,
    allow_member_combat_power_edit INTEGER NOT NULL DEFAULT 1 CHECK (allow_member_combat_power_edit IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO guild_settings_v2 (
    guild_id,
    guild_name,
    allow_member_combat_power_edit,
    created_at,
    updated_at
)
SELECT
    1,
    guild_name,
    allow_member_combat_power_edit,
    created_at,
    updated_at
FROM guild_settings
WHERE id = 1;

DROP TABLE guild_settings;
ALTER TABLE guild_settings_v2 RENAME TO guild_settings;

ALTER TABLE users
    ADD COLUMN guild_id INTEGER NOT NULL DEFAULT 1 REFERENCES guilds(id);

CREATE INDEX idx_users_guild ON users (guild_id);
CREATE UNIQUE INDEX idx_users_username_nocase ON users (username COLLATE NOCASE);

CREATE TABLE characters (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    occupation TEXT NOT NULL,
    main_class TEXT NOT NULL,
    combat_power INTEGER NOT NULL CHECK (combat_power >= 0),
    equipment_json TEXT NOT NULL DEFAULT '{}',
    skills_json TEXT NOT NULL DEFAULT '{}',
    max_crit_rate REAL NOT NULL DEFAULT 0,
    max_crit_resist REAL NOT NULL DEFAULT 0,
    status_effect_acc REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    role TEXT NOT NULL CHECK (role IN ('ADMIN', 'MEMBER')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_invites_guild_role ON invites (guild_id, role);
