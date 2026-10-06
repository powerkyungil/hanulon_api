ALTER TABLE distribution_periods
    ADD COLUMN rounding_mode TEXT NOT NULL DEFAULT 'NONE'
    CHECK (rounding_mode IN ('NONE', 'ROUND', 'CEIL', 'FLOOR'));

ALTER TABLE distribution_members
    ADD COLUMN payable_diamonds TEXT NOT NULL DEFAULT '0';

ALTER TABLE distribution_members
    ADD COLUMN rounding_adjustment TEXT NOT NULL DEFAULT '0';

UPDATE distribution_members
SET payable_diamonds = final_diamonds,
    rounding_adjustment = '0';
