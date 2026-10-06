ALTER TABLE distribution_periods
    ADD COLUMN start_date_iso TEXT NOT NULL DEFAULT '1970-01-01';

ALTER TABLE distribution_periods
    ADD COLUMN end_date_iso TEXT NOT NULL DEFAULT '1970-01-01';

UPDATE distribution_periods
SET start_date_iso = date(start_date / 1000, 'unixepoch', '+9 hours'),
    end_date_iso = date(end_date / 1000, 'unixepoch', '+9 hours');

CREATE INDEX idx_distribution_periods_guild_status_iso_dates
    ON distribution_periods (guild_id, status, start_date_iso DESC, id DESC);
