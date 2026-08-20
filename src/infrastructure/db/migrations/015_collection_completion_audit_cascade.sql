ALTER TABLE collection_audit_logs
ADD COLUMN collection_item_id INTEGER REFERENCES collection_items(id) ON DELETE CASCADE;

UPDATE collection_audit_logs
SET collection_item_id = CAST(json_extract(metadata_json, '$.collectionItemId') AS INTEGER)
WHERE action = 'COMPLETION_CHANGED'
  AND EXISTS (
      SELECT 1
      FROM collection_items
      WHERE collection_items.id = CAST(
          json_extract(collection_audit_logs.metadata_json, '$.collectionItemId') AS INTEGER
      )
  );

DELETE FROM collection_audit_logs
WHERE action = 'COMPLETION_CHANGED'
  AND collection_item_id IS NULL;

CREATE INDEX idx_collection_audit_logs_item
    ON collection_audit_logs (collection_item_id);
