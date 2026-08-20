CREATE INDEX IF NOT EXISTS idx_messages_starred
  ON messages (mailbox, date_ms DESC)
  WHERE starred = 1 AND folder != 'trash';

CREATE INDEX IF NOT EXISTS idx_messages_msgid
  ON messages (mailbox, internet_message_id);

CREATE INDEX IF NOT EXISTS idx_messages_created
  ON messages (created_at DESC);

CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE id = old.id;
END;
