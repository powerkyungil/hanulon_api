CREATE INDEX idx_collection_audit_logs_guild_action_id
    ON collection_audit_logs (guild_id, action, id DESC);
