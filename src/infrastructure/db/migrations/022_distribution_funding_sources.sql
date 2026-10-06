ALTER TABLE distribution_periods
    ADD COLUMN siege_diamonds TEXT NOT NULL DEFAULT '0';
ALTER TABLE distribution_periods
    ADD COLUMN guild_cash TEXT NOT NULL DEFAULT '0';
ALTER TABLE distribution_periods
    ADD COLUMN scroll_craft_diamonds TEXT NOT NULL DEFAULT '0';
ALTER TABLE distribution_periods
    ADD COLUMN instant_revive_diamonds TEXT NOT NULL DEFAULT '0';

UPDATE distribution_periods
SET siege_diamonds = total_fund;
