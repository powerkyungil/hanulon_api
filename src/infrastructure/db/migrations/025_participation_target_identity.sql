ALTER TABLE participation_targets RENAME TO participation_targets_definition_ids;

CREATE TABLE participation_targets (
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    region TEXT NOT NULL,
    boss TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, type, region, boss)
);

INSERT OR IGNORE INTO participation_targets (guild_id, type, region, boss, created_at)
SELECT target.guild_id, definition.type, definition.region, definition.boss, target.created_at
FROM participation_targets_definition_ids AS target
JOIN boss_definitions AS definition
    ON definition.guild_id = target.guild_id
    AND definition.id = target.boss_definition_id;

-- Recover target identities for historical votes whose definition targets were
-- already cascade-deleted by a previous boss reset.
INSERT OR IGNORE INTO participation_targets (guild_id, type, region, boss, created_at)
SELECT DISTINCT history.guild_id, history.type, history.region, history.boss, history.recorded_at
FROM schedule_history AS history
WHERE EXISTS (
    SELECT 1
    FROM boss_participants AS participant
    WHERE participant.guild_id = history.guild_id
      AND participant.vote_key = history.type || '|' || history.region || '|'
        || history.boss || '|' || history.spawn_time
)
OR EXISTS (
    SELECT 1
    FROM participation_states AS state
    WHERE state.guild_id = history.guild_id
      AND state.vote_key = history.type || '|' || history.region || '|'
        || history.boss || '|' || history.spawn_time
);

DROP TABLE participation_targets_definition_ids;

-- Older schedule deletes and corrections only hid snapshot rows. Restore their
-- visibility now that schedule removal no longer controls vote visibility.
UPDATE schedule_history SET vote_hidden = 0 WHERE vote_hidden <> 0;
