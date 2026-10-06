CREATE TABLE IF NOT EXISTS project_tokens (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  token_encrypted TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE connections_history_v2 (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  name TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'refresh')),
  at TEXT NOT NULL
);

INSERT INTO connections_history_v2 (id, project, name, action, at)
SELECT id, project, name, action, at FROM connections_history;

DROP TABLE connections_history;

ALTER TABLE connections_history_v2 RENAME TO connections_history;
