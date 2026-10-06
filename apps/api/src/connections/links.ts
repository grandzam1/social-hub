import type { ConnectionsDb, ConnectionsEnv } from "./index.js";

const PROJECT_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
const MAX_LINKS = 20;

function requireDb(env: ConnectionsEnv): ConnectionsDb {
  if (!env.DB) throw new Error("D1 binding DB is not configured");
  return env.DB;
}

function assertProjectName(project: string): string {
  const name = project.trim();
  if (!PROJECT_PATTERN.test(name)) {
    throw new Error("project must be 1-64 letters, numbers, dots, dashes, or underscores");
  }
  return name;
}

/** Direct source projects, earliest position first. */
export async function listProjectLinks(env: ConnectionsEnv, project: string): Promise<string[]> {
  const db = requireDb(env);
  const data = await db
    .prepare("SELECT source FROM project_links WHERE project = ? ORDER BY position ASC")
    .bind(project)
    .all<{ source: string }>();
  return (data.results ?? []).map((row) => row.source);
}

/**
 * Replace the projects whose own stored secrets this project may inherit.
 * Inheritance is read-only and is not transitive.
 */
export async function setProjectLinks(
  env: ConnectionsEnv,
  project: string,
  sources: string[],
): Promise<string[]> {
  const projectName = assertProjectName(project);
  if (projectName === "global") throw new Error("global cannot inherit secrets");
  if (!Array.isArray(sources)) throw new Error("sources must be a list");
  if (sources.length > MAX_LINKS) throw new Error("too many linked projects");

  const cleaned = sources.map((source) => assertProjectName(String(source)));
  const seen = new Set<string>();
  for (const source of cleaned) {
    if (source === projectName) throw new Error("a project cannot inherit from itself");
    if (source === "global") throw new Error("global is already the fallback");
    if (seen.has(source)) throw new Error("duplicate source");
    seen.add(source);
  }

  const db = requireDb(env);
  await db.batch([
    db.prepare("DELETE FROM project_links WHERE project = ?").bind(projectName),
    ...cleaned.map((source, position) =>
      db
        .prepare("INSERT INTO project_links (id, project, source, position) VALUES (?, ?, ?, ?)")
        .bind(crypto.randomUUID(), projectName, source, position),
    ),
  ]);
  return cleaned;
}
