CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('secret', 'setting')),
  value_encrypted TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project, name)
);

CREATE TABLE connections_history (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  name TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  at TEXT NOT NULL
);
