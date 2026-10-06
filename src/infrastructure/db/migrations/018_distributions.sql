CREATE TABLE distribution_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
    start_date INTEGER NOT NULL,
    end_date INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED')),
    total_fund TEXT NOT NULL,
    participation_weight TEXT NOT NULL DEFAULT '50',
    alliance_weight TEXT NOT NULL DEFAULT '50',
    cash_rate TEXT NOT NULL DEFAULT '4.5',
    created_by INTEGER NOT NULL,
    confirmed_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TEXT,
    CHECK (start_date <= end_date)
);

CREATE INDEX idx_distribution_periods_guild_status_dates
    ON distribution_periods (guild_id, status, start_date DESC, id DESC);

CREATE TABLE distribution_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    distribution_id INTEGER NOT NULL REFERENCES distribution_periods(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,
    nickname_snapshot TEXT NOT NULL,
    occupation_snapshot TEXT,
    main_class_snapshot TEXT,
    combat_power_snapshot INTEGER,
    participation_rate TEXT,
    alliance_rate TEXT NOT NULL DEFAULT '0',
    payout_multiplier TEXT NOT NULL DEFAULT '1',
    instant_revive_cost TEXT NOT NULL DEFAULT '0',
    gold_support_cost TEXT NOT NULL DEFAULT '0',
    operation_cost TEXT NOT NULL DEFAULT '0',
    other_support_cost TEXT NOT NULL DEFAULT '0',
    note TEXT,
    participation_share TEXT NOT NULL DEFAULT '0',
    alliance_share TEXT NOT NULL DEFAULT '0',
    participation_amount TEXT NOT NULL DEFAULT '0',
    alliance_amount TEXT NOT NULL DEFAULT '0',
    support_total TEXT NOT NULL DEFAULT '0',
    final_diamonds TEXT NOT NULL DEFAULT '0',
    cash_amount TEXT NOT NULL DEFAULT '0',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (distribution_id, user_id)
);

CREATE INDEX idx_distribution_members_distribution
    ON distribution_members (distribution_id, id);

CREATE TABLE distribution_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    distribution_id INTEGER NOT NULL,
    actor_user_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (action IN (
        'CREATED', 'PERIOD_UPDATED', 'MEMBER_UPDATED', 'MEMBERS_BULK_UPDATED',
        'CALCULATED', 'CONFIRMED', 'REOPENED', 'DELETED'
    )),
    reason TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_distribution_audit_logs_distribution
    ON distribution_audit_logs (guild_id, distribution_id, created_at DESC, id DESC);
