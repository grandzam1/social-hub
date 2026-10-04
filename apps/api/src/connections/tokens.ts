import { decryptValue, encryptValue, maskToken, sha256Hex } from "./crypto.js";
import type { ConnectionsDb, ConnectionsEnv } from "./index.js";

export type ProjectToken = {
  id: string;
  project: string;
  label: string;
  preview: string;
  created_at: string;
  last_used_at: string | null;
};

type TokenRow = {
  id: string;
  project: string;
  label: string;
  token_encrypted: string;
  token_hash: string;
  created_at: string;
  last_used_at: string | null;
};

function requireDb(env: ConnectionsEnv): ConnectionsDb {
  if (!env.DB) throw new Error("D1 binding DB is not configured");
  return env.DB;
}

function requireMasterKey(env: ConnectionsEnv): string {
  const key = env.MASTER_KEY?.trim();
  if (!key) throw new Error("MASTER_KEY is not set");
  return key;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function newToken(): string {
  return `vault_${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

async function history(
  db: ConnectionsDb,
  project: string,
  label: string,
  action: "create" | "refresh" | "delete",
  at: string,
) {
  return db
    .prepare(
      "INSERT INTO connections_history (id, project, name, action, at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(crypto.randomUUID(), project, label.trim() || "token", action, at);
}

async function readToken(db: ConnectionsDb, id: string): Promise<TokenRow | null> {
  return db
    .prepare(
      "SELECT id, project, label, token_encrypted, token_hash, created_at, last_used_at FROM project_tokens WHERE id = ?",
    )
    .bind(id)
    .first<TokenRow>();
}

function summarize(row: TokenRow, token: string): ProjectToken {
  return {
    id: row.id,
    project: row.project,
    label: row.label,
    preview: maskToken(token),
    created_at: row.created_at,
    last_used_at: row.last_used_at,
  };
}

export async function listProjectTokens(env: ConnectionsEnv): Promise<ProjectToken[]> {
  const db = requireDb(env);
  const masterKey = requireMasterKey(env);
  const data = await db
    .prepare(
      "SELECT id, project, label, token_encrypted, token_hash, created_at, last_used_at FROM project_tokens ORDER BY created_at DESC",
    )
    .all<TokenRow>();
  const tokens: ProjectToken[] = [];
  for (const row of data.results ?? []) {
    tokens.push(summarize(row, await decryptValue(masterKey, row.token_encrypted)));
  }
  return tokens;
}

export async function createProjectToken(
  env: ConnectionsEnv,
  project: string,
  label: string,
): Promise<ProjectToken & { token: string }> {
  const db = requireDb(env);
  const masterKey = requireMasterKey(env);
  const token = newToken();
  const now = new Date().toISOString();
  const row: TokenRow = {
    id: crypto.randomUUID(),
    project,
    label: label.trim(),
    token_encrypted: await encryptValue(masterKey, token),
    token_hash: await sha256Hex(token),
    created_at: now,
    last_used_at: null,
  };
  await db.batch([
    db
      .prepare(
        "INSERT INTO project_tokens (id, project, label, token_encrypted, token_hash, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
      )
      .bind(row.id, row.project, row.label, row.token_encrypted, row.token_hash, row.created_at),
    await history(db, project, row.label, "create", now),
  ]);
  return { ...summarize(row, token), token };
}

export async function revealProjectToken(
  env: ConnectionsEnv,
  id: string,
): Promise<string | null> {
  const db = requireDb(env);
  const row = await readToken(db, id);
  if (!row) return null;
  return decryptValue(requireMasterKey(env), row.token_encrypted);
}

export async function refreshProjectToken(
  env: ConnectionsEnv,
  id: string,
): Promise<(ProjectToken & { token: string }) | null> {
  const db = requireDb(env);
  const masterKey = requireMasterKey(env);
  const existing = await readToken(db, id);
  if (!existing) return null;
  const token = newToken();
  const now = new Date().toISOString();
  const row: TokenRow = {
    ...existing,
    token_encrypted: await encryptValue(masterKey, token),
    token_hash: await sha256Hex(token),
  };
  await db.batch([
    db
      .prepare("UPDATE project_tokens SET token_encrypted = ?, token_hash = ? WHERE id = ?")
      .bind(row.token_encrypted, row.token_hash, id),
    await history(db, existing.project, existing.label, "refresh", now),
  ]);
  return { ...summarize(row, token), token };
}

export async function deleteProjectToken(env: ConnectionsEnv, id: string): Promise<boolean> {
  const db = requireDb(env);
  const existing = await readToken(db, id);
  if (!existing) return false;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("DELETE FROM project_tokens WHERE id = ?").bind(id),
    await history(db, existing.project, existing.label, "delete", now),
  ]);
  return true;
}

export async function readVaultEnv(
  env: ConnectionsEnv,
  token: string,
): Promise<{ project: string; values: Record<string, string> } | null> {
  const db = requireDb(env);
  const masterKey = requireMasterKey(env);
  const hash = await sha256Hex(token);
  const owner = await db
    .prepare("SELECT id, project FROM project_tokens WHERE token_hash = ?")
    .bind(hash)
    .first<{ id: string; project: string }>();
  if (!owner) return null;

  const data = await db
    .prepare(
      "SELECT project, name, value_encrypted FROM connections WHERE project = ? OR project = 'global'",
    )
    .bind(owner.project)
    .all<{ project: string; name: string; value_encrypted: string }>();
  const values: Record<string, string> = {};
  const rows = data.results ?? [];
  for (const row of rows.filter((row) => row.project === "global")) {
    values[row.name] = await decryptValue(masterKey, row.value_encrypted);
  }
  if (owner.project !== "global") {
    for (const row of rows.filter((row) => row.project === owner.project)) {
      values[row.name] = await decryptValue(masterKey, row.value_encrypted);
    }
  }
  await db
    .prepare("UPDATE project_tokens SET last_used_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), owner.id)
    .run();
  return { project: owner.project, values };
}
