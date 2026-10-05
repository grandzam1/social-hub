CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  metric TEXT NOT NULL,
  delta REAL NOT NULL,
  unit TEXT NOT NULL,
  path TEXT,
  method TEXT,
  status_code INTEGER,
  detail TEXT,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS usage_events_occurred_at
  ON usage_events (occurred_at DESC);
