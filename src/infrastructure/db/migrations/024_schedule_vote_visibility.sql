-- Keep occurrence snapshots while excluding deleted/corrected schedules from votes.
ALTER TABLE schedule_history ADD COLUMN vote_hidden INTEGER NOT NULL DEFAULT 0
    CHECK (vote_hidden IN (0, 1));
