-- HTML email templates (shared across mailboxes).

CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  html TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_templates_name
  ON email_templates (name COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_email_templates_updated
  ON email_templates (updated_at DESC);
