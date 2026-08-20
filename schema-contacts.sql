CREATE TABLE IF NOT EXISTS contacts (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts (name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_contacts_created ON contacts (created_at DESC);
