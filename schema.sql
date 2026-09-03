CREATE TABLE IF NOT EXISTS mailboxes (
  address TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  mailbox TEXT NOT NULL,
  folder TEXT NOT NULL,
  direction TEXT NOT NULL,
  from_addr TEXT NOT NULL,
  from_name TEXT NOT NULL DEFAULT '',
  to_addrs TEXT NOT NULL DEFAULT '[]',
  cc_addrs TEXT NOT NULL DEFAULT '[]',
  bcc_addrs TEXT NOT NULL DEFAULT '[]',
  reply_to TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  thread_id TEXT NOT NULL,
  internet_message_id TEXT NOT NULL DEFAULT '',
  in_reply_to TEXT NOT NULL DEFAULT '',
  date_ms INTEGER NOT NULL,
  unread INTEGER NOT NULL DEFAULT 1,
  starred INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  has_html INTEGER NOT NULL DEFAULT 0,
  has_text INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (mailbox) REFERENCES mailboxes(address)
);

CREATE INDEX IF NOT EXISTS idx_messages_mailbox_folder_date
  ON messages (mailbox, folder, date_ms DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (thread_id, date_ms);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages (mailbox, unread);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  id UNINDEXED,
  subject,
  snippet,
  from_addr,
  to_addrs,
  tokenize = 'porter'
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments (message_id);

CREATE INDEX IF NOT EXISTS idx_messages_starred
  ON messages (mailbox, date_ms DESC)
  WHERE starred = 1 AND folder != 'trash';

CREATE INDEX IF NOT EXISTS idx_messages_msgid
  ON messages (mailbox, internet_message_id);

CREATE INDEX IF NOT EXISTS idx_messages_created
  ON messages (created_at DESC);

CREATE TABLE IF NOT EXISTS contacts (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts (name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_contacts_created ON contacts (created_at DESC);

CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE id = old.id;
END;
