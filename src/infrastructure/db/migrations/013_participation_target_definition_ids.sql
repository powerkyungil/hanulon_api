ALTER TABLE participation_targets RENAME TO participation_targets_legacy;

CREATE TABLE participation_targets (
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    boss_definition_id INTEGER NOT NULL REFERENCES boss_definitions(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, boss_definition_id)
);

INSERT OR IGNORE INTO participation_targets (guild_id, boss_definition_id, created_at)
SELECT target.guild_id, definition.id, target.created_at
FROM participation_targets_legacy AS target
JOIN boss_definitions AS definition
    ON definition.guild_id = target.guild_id AND definition.boss = target.boss
WHERE (
    SELECT COUNT(*)
    FROM boss_definitions AS candidate
    WHERE candidate.guild_id = target.guild_id AND candidate.boss = target.boss
) = 1;

DROP TABLE participation_targets_legacy;
