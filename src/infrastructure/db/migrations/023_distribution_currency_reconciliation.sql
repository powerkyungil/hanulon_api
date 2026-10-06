ALTER TABLE distribution_periods
    ADD COLUMN held_diamonds TEXT NOT NULL DEFAULT '0';

ALTER TABLE distribution_periods
    ADD COLUMN held_cash TEXT NOT NULL DEFAULT '0';

ALTER TABLE distribution_periods
    ADD COLUMN alliance_received_diamonds TEXT NOT NULL DEFAULT '0';

ALTER TABLE distribution_periods
    ADD COLUMN alliance_received_cash TEXT NOT NULL DEFAULT '0';

ALTER TABLE distribution_periods
    ADD COLUMN distribution_diamonds TEXT NOT NULL DEFAULT '0';

ALTER TABLE distribution_periods
    ADD COLUMN distribution_cash TEXT NOT NULL DEFAULT '0';

UPDATE distribution_periods
SET held_diamonds = siege_diamonds + scroll_craft_diamonds + instant_revive_diamonds,
    held_cash = guild_cash,
    distribution_diamonds = siege_diamonds + scroll_craft_diamonds + instant_revive_diamonds,
    distribution_cash = guild_cash,
    alliance_received_diamonds = '0',
    alliance_received_cash = '0';
