CREATE TABLE guild_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    guild_name TEXT NOT NULL,
    allow_member_combat_power_edit INTEGER NOT NULL DEFAULT 1 CHECK (allow_member_combat_power_edit IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO guild_settings (id, guild_name)
VALUES (1, '오딘 길드');

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('MASTER', 'ADMIN', 'MEMBER')),
    nickname TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_role ON users (role);
CREATE INDEX idx_users_active ON users (is_active);
