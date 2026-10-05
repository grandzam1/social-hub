CREATE TABLE project_links (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  source TEXT NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE (project, source)
);

CREATE INDEX project_links_project ON project_links (project, position);
