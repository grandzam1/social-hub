import { z } from "zod";
import { decryptValue, encryptValue, maskPreview } from "./crypto.js";

export type ConnectionKind = "secret" | "setting";

type Statement = {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
};

export type ConnectionsDb = {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown>;
};

export type ConnectionsEnv = {
  DB?: ConnectionsDb;
  MASTER_KEY?: string;
};

export type ConnectionSummary = {
  project: string;
  name: string;
  kind: ConnectionKind;
  updated_at: string;
  preview: string;
};

type StoredRow = {
  id: string;
  project: string;
  name: string;
  kind: ConnectionKind;
  value_encrypted: string;
  updated_at: string;
};

const CACHE_MS = 60_000;
const cache = new Map<string, { value: string; expires: number }>();

function cacheKey(project: string, name: string) {
  return `${project}\0${name}`;
}

export function clearConnectionsCache() {
  cache.clear();
}

function readCache(project: string, name: string): string | undefined {
  const hit = cache.get(cacheKey(project, name));
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    cache.delete(cacheKey(project, name));
    return undefined;
  }
  return hit.value;
}

function writeCache(project: string, name: string, value: string) {
  cache.set(cacheKey(project, name), {
    value,
    expires: Date.now() + CACHE_MS,
  });
}

function requireDb(env: ConnectionsEnv): ConnectionsDb {
  if (!env.DB) throw new Error("D1 binding DB is not configured");
  return env.DB;
}

function requireMasterKey(env: ConnectionsEnv): string {
  const key = env.MASTER_KEY?.trim();
  if (!key) throw new Error("MASTER_KEY is not set");
  return key;
}

export function isReservedConnectionName(name: string): boolean {
  return name.trim().toLowerCase() === "master_key";
}

async function readRow(
  db: ConnectionsDb,
  project: string,
  name: string,
): Promise<StoredRow | null> {
  return db
    .prepare(
      "SELECT id, project, name, kind, value_encrypted, updated_at FROM connections WHERE project = ? AND name = ?",
    )
    .bind(project, name)
    .first<StoredRow>();
}

/** Decrypted value stored on this project only. Does not fall back to global or links. */
export async function getStoredConnection(
  env: ConnectionsEnv,
  project: string,
  name: string,
): Promise<string | null> {
  if (!env.DB) return null;
  const row = await readRow(env.DB, project, name);
  if (!row) return null;
  return decryptValue(requireMasterKey(env), row.value_encrypted);
}

/**
 * Decrypted value for this project, or the "global" project when this one has no row.
 * Returns null when nothing is stored. Cached in memory for 60 seconds.
 */
export async function getConnection(
  env: ConnectionsEnv,
  project: string,
  name: string,
): Promise<string | null> {
  if (!env.DB) return null;
  const cached = readCache(project, name);
  if (cached !== undefined) return cached;

  const own = await readRow(env.DB, project, name);
  const row =
    own ?? (project === "global" ? null : await readRow(env.DB, "global", name));
  if (!row) return null;

  const value = await decryptValue(requireMasterKey(env), row.value_encrypted);
  writeCache(row.project, row.name, value);
  if (row.project !== project) writeCache(project, name, value);
  return value;
}

export async function setConnection(
  env: ConnectionsEnv,
  project: string,
  name: string,
  kind: ConnectionKind,
  value: string,
): Promise<{ action: "create" | "update" }> {
  if (isReservedConnectionName(name)) throw new Error("reserved name");
  const db = requireDb(env);
  const encrypted = await encryptValue(requireMasterKey(env), value);
  const existing = await readRow(db, project, name);
  const action: "create" | "update" = existing ? "update" : "create";
  const now = new Date().toISOString();
  const id = existing?.id ?? crypto.randomUUID();
  const write = existing
    ? db
        .prepare(
          "UPDATE connections SET kind = ?, value_encrypted = ?, updated_at = ? WHERE id = ?",
        )
        .bind(kind, encrypted, now, id)
    : db
        .prepare(
          "INSERT INTO connections (id, project, name, kind, value_encrypted, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(id, project, name, kind, encrypted, now);
  const history = db
    .prepare(
      "INSERT INTO connections_history (id, project, name, action, at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(crypto.randomUUID(), project, name, action, now);
  await db.batch([write, history]);
  clearConnectionsCache();
  return { action };
}

export async function deleteConnection(
  env: ConnectionsEnv,
  project: string,
  name: string,
): Promise<boolean> {
  const db = requireDb(env);
  const existing = await readRow(db, project, name);
  if (!existing) return false;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("DELETE FROM connections WHERE id = ?").bind(existing.id),
    db
      .prepare(
        "INSERT INTO connections_history (id, project, name, action, at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(crypto.randomUUID(), project, name, "delete", now),
  ]);
  clearConnectionsCache();
  return true;
}

export async function listConnections(
  env: ConnectionsEnv,
): Promise<ConnectionSummary[]> {
  const db = requireDb(env);
  const masterKey = requireMasterKey(env);
  const data = await db
    .prepare(
      "SELECT project, name, kind, value_encrypted, updated_at FROM connections ORDER BY project, name",
    )
    .all<StoredRow>();
  const rows = data.results ?? [];
  const summaries: ConnectionSummary[] = [];
  for (const row of rows) {
    const value = await decryptValue(masterKey, row.value_encrypted);
    summaries.push({
      project: row.project,
      name: row.name,
      kind: row.kind,
      updated_at: row.updated_at,
      preview: maskPreview(value),
    });
  }
  return summaries;
}

const variableName = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "illegal characters");

const bulkItem = z.object({
  name: z.string(),
  value: z.string(),
  kind: z.enum(["secret", "setting"]),
});

function bulkSkipReason(item: { name?: unknown; value?: unknown; kind?: unknown }): string {
  const name = typeof item.name === "string" ? item.name : "";
  if (!name) return "empty name";
  if (!variableName.safeParse(name).success) return "illegal characters";
  if (typeof item.value !== "string" || !item.value) return "empty value";
  if (item.kind !== "secret" && item.kind !== "setting") return "kind must be secret or setting";
  return "illegal characters";
}

export async function setConnectionsBulk(
  env: ConnectionsEnv,
  project: string,
  items: unknown[],
): Promise<{
  saved: Array<{ name: string; action: "create" | "update" }>;
  skipped: Array<{ name: string; reason: string }>;
}> {
  const db = requireDb(env);
  const masterKey = requireMasterKey(env);
  const saved: Array<{ name: string; action: "create" | "update" }> = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  const seen = new Set<string>();
  const statements: Statement[] = [];

  for (const raw of items) {
    const parsed = bulkItem.safeParse(raw);
    if (!parsed.success) {
      skipped.push({
        name: typeof (raw as { name?: unknown })?.name === "string" ? (raw as { name: string }).name : "",
        reason: bulkSkipReason(
          raw && typeof raw === "object" ? (raw as { name?: unknown; value?: unknown; kind?: unknown }) : {},
        ),
      });
      continue;
    }
    if (!variableName.safeParse(parsed.data.name).success || !parsed.data.value) {
      skipped.push({
        name: parsed.data.name,
        reason: bulkSkipReason(parsed.data),
      });
      continue;
    }
    if (isReservedConnectionName(parsed.data.name)) {
      skipped.push({ name: parsed.data.name, reason: "reserved name" });
      continue;
    }
    if (seen.has(parsed.data.name)) {
      skipped.push({ name: parsed.data.name, reason: "duplicate name in the paste" });
      continue;
    }
    seen.add(parsed.data.name);
    const existing = await readRow(db, project, parsed.data.name);
    const action: "create" | "update" = existing ? "update" : "create";
    const encrypted = await encryptValue(masterKey, parsed.data.value);
    const now = new Date().toISOString();
    const id = existing?.id ?? crypto.randomUUID();
    statements.push(
      existing
        ? db
            .prepare(
              "UPDATE connections SET kind = ?, value_encrypted = ?, updated_at = ? WHERE id = ?",
            )
            .bind(parsed.data.kind, encrypted, now, id)
        : db
            .prepare(
              "INSERT INTO connections (id, project, name, kind, value_encrypted, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(id, project, parsed.data.name, parsed.data.kind, encrypted, now),
    );
    statements.push(
      db
        .prepare(
          "INSERT INTO connections_history (id, project, name, action, at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(crypto.randomUUID(), project, parsed.data.name, action, now),
    );
    saved.push({ name: parsed.data.name, action });
  }

  if (statements.length) {
    await db.batch(statements);
    clearConnectionsCache();
  }
  return { saved, skipped };
}

export async function listProjectValues(
  env: ConnectionsEnv,
  project: string,
): Promise<Array<{ name: string; value: string }>> {
  const db = requireDb(env);
  const masterKey = requireMasterKey(env);
  const data = await db
    .prepare(
      "SELECT name, value_encrypted FROM connections WHERE project = ? ORDER BY name",
    )
    .bind(project)
    .all<{ name: string; value_encrypted: string }>();
  const values: Array<{ name: string; value: string }> = [];
  for (const row of data.results ?? []) {
    values.push({
      name: row.name,
      value: await decryptValue(masterKey, row.value_encrypted),
    });
  }
  return values;
}
