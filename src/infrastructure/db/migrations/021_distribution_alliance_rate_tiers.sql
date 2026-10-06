CREATE TABLE distribution_alliance_rate_tiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    min_combat_power INTEGER NOT NULL CHECK (min_combat_power >= 80000),
    max_combat_power INTEGER NOT NULL CHECK (max_combat_power >= min_combat_power),
    alliance_rate TEXT NOT NULL,
    updated_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guild_id, min_combat_power),
    UNIQUE (guild_id, max_combat_power)
);

CREATE INDEX idx_distribution_alliance_rate_tiers_guild_range
    ON distribution_alliance_rate_tiers (guild_id, min_combat_power, max_combat_power);
