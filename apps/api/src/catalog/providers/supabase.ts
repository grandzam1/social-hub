import { connectionsEnv } from "../../connections/runtime.js";
import type { ConnectionsEnv } from "../../connections/index.js";
import { getAppSecret } from "../../connections/secrets.js";
import type { AirtableRecord, Catalog, CatalogPage } from "../types.js";

const REST = "/rest/v1";

type TableName = "profiles" | "posts" | "media";

type Row = {
  id: string;
  fields: Record<string, unknown>;
  created_at?: string;
};

export type SupabaseCatalogOptions = {
  /** Isolates reads and writes from live rows. Empty string is the live catalog. */
  namespace?: string;
  env?: ConnectionsEnv;
};

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  return `rec${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function redact(text: string): string {
  return text
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/sb_publishable_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

export async function assertSupabaseConfigured(env: ConnectionsEnv): Promise<void> {
  const storedUrl = (await getAppSecret(env, "supabase_url"))?.trim();
  const storedKey = (await getAppSecret(env, "supabase_secret_key"))?.trim();
  const missing: string[] = [];
  if (!storedUrl) missing.push("SUPABASE_URL");
  if (!storedKey) missing.push("SUPABASE_SECRET_KEY");
  if (missing.length) {
    throw new Error(
      `Missing ${missing.join(" and ")}. Set ${missing.join(" and ")}, or choose Airtable for the database setting. Switching does not move data.`,
    );
  }
}

async function credentials(env: ConnectionsEnv): Promise<{ url: string; key: string }> {
  await assertSupabaseConfigured(env);
  const storedUrl = (await getAppSecret(env, "supabase_url"))?.trim() ?? "";
  const storedKey = (await getAppSecret(env, "supabase_secret_key"))?.trim() ?? "";
  const url = storedUrl.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const key = storedKey;
  return { url, key };
}

function asRecord(row: Row): AirtableRecord {
  return {
    id: row.id,
    fields: row.fields ?? {},
    createdTime: row.created_at,
  };
}

function variants(handle: string): string[] {
  const bare = handle.replace(/^@/, "").trim();
  return [...new Set([handle.trim(), bare, `@${bare}`].filter(Boolean))];
}

function profileKey(fields: Record<string, unknown>, id: string): string {
  const handle = String(fields.Handle ?? "");
  const platform = String(fields.Platform ?? "");
  if (handle && platform) return `${platform}:${handle}`;
  return id;
}

function postKey(fields: Record<string, unknown>, id: string): string {
  const postId = String(fields["Post ID"] ?? "");
  return postId || id;
}

function mediaKey(fields: Record<string, unknown>, id: string): string {
  const mediaId = String(fields["Media ID"] ?? "");
  return mediaId || id;
}

export function createSupabaseCatalog(options: SupabaseCatalogOptions = {}): Catalog {
  const namespace = options.namespace ?? "";
  const env = options.env;

  async function rest<T>(
    table: TableName,
    operation: string,
    init: {
      method?: string;
      query?: URLSearchParams;
      body?: unknown;
      prefer?: string;
    } = {},
  ): Promise<T> {
    const { url, key } = await credentials(env ?? connectionsEnv());
    const query = init.query ?? new URLSearchParams();
    const method = init.method ?? "GET";
    if (method !== "POST" && !query.has("namespace")) {
      query.set("namespace", `eq.${namespace}`);
    }
    const target = `${url}${REST}/${table}?${query}`;
    let res: Response;
    try {
      res = await fetch(target, {
        method,
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          ...(init.prefer ? { Prefer: init.prefer } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Supabase ${table} ${operation}: ${redact(message)}`);
    }
    const text = await res.text();
    if (!res.ok) {
      let code = "";
      try {
        const parsed = JSON.parse(text) as { code?: string };
        code = parsed.code ? ` ${parsed.code}` : "";
      } catch {
        code = "";
      }
      throw new Error(`Supabase ${table} ${operation}: ${res.status}${code}`);
    }
    if (!text) return [] as T;
    return JSON.parse(text) as T;
  }

  async function rows(
    table: TableName,
    operation: string,
    query: URLSearchParams,
  ): Promise<AirtableRecord[]> {
    query.set("select", "id,fields,created_at");
    const data = await rest<Row[]>(table, operation, { query });
    return data.map(asRecord);
  }

  async function one(
    table: TableName,
    operation: string,
    id: string,
  ): Promise<AirtableRecord> {
    const query = new URLSearchParams({
      id: `eq.${id}`,
      select: "id,fields,created_at",
      limit: "1",
    });
    const data = await rest<Row[]>(table, operation, { query });
    const row = data[0];
    if (!row) throw new Error(`Supabase ${table} ${operation}: not found`);
    return asRecord(row);
  }

  async function upsert(
    table: TableName,
    operation: string,
    onConflict: string,
    body: Record<string, unknown>,
  ): Promise<AirtableRecord> {
    const query = new URLSearchParams({ on_conflict: onConflict });
    const data = await rest<Row[]>(table, operation, {
      method: "POST",
      query,
      body: [{ ...body, namespace }],
      prefer: "resolution=merge-duplicates,return=representation",
    });
    const row = data[0];
    if (!row) throw new Error(`Supabase ${table} ${operation}: empty result`);
    return asRecord(row);
  }

  async function patch(
    table: TableName,
    operation: string,
    id: string,
    fields: Record<string, unknown>,
  ): Promise<AirtableRecord> {
    const query = new URLSearchParams({ id: `eq.${id}` });
    const data = await rest<Row[]>(table, operation, {
      method: "PATCH",
      query,
      body: { fields },
      prefer: "return=representation",
    });
    const row = data[0];
    if (!row) throw new Error(`Supabase ${table} ${operation}: not found`);
    return asRecord(row);
  }

  function page(records: AirtableRecord[]): CatalogPage {
    return { records };
  }

  return {
    async upsertProfile(fields) {
      const handle = String(fields.Handle ?? "");
      const platform = String(fields.Platform ?? "");
      const id = newId();
      return upsert("profiles", "upsert", "namespace,profile_key", {
        ...(handle && platform ? {} : { id }),
        profile_key: profileKey(fields, id),
        fields,
      });
    },

    async upsertPost(fields) {
      const natural = String(fields["Post ID"] ?? "");
      const id = newId();
      return upsert("posts", "upsert", "namespace,post_key", {
        ...(natural ? {} : { id }),
        post_key: postKey(fields, id),
        fields,
      });
    },

    async upsertMedia(fields) {
      const natural = String(fields["Media ID"] ?? "");
      const id = newId();
      const postLink = Array.isArray(fields.Post) ? String(fields.Post[0] ?? "") : "";
      return upsert("media", "upsert", "namespace,media_key", {
        ...(natural ? {} : { id }),
        media_key: mediaKey(fields, id),
        ...(postLink ? { post_id: postLink } : {}),
        fields,
      });
    },

    async getPost(recordId) {
      return one("posts", "get", recordId);
    },

    async getMedia(recordId) {
      return one("media", "get", recordId);
    },

    async listMediaForPost(postRecordId) {
      const query = new URLSearchParams({
        post_id: `eq.${postRecordId}`,
        order: "slide_order.asc",
        limit: "100",
      });
      return rows("media", "list-for-post", query);
    },

    async updatePost(recordId, fields) {
      return patch("posts", "update", recordId, fields);
    },

    async updateMedia(recordId, fields) {
      return patch("media", "update", recordId, fields);
    },

    async listPosts(pageSize = 50) {
      const query = new URLSearchParams({
        order: "scraped.desc.nullslast",
        limit: String(pageSize),
      });
      return page(await rows("posts", "list", query));
    },

    async listMedia(pageSize = 100) {
      const query = new URLSearchParams({
        order: "created_at.desc",
        limit: String(Math.min(pageSize, 100)),
      });
      return page(await rows("media", "list", query));
    },

    async listProfiles(pageSize = 100) {
      const query = new URLSearchParams({
        order: "created_at.desc",
        limit: String(Math.min(pageSize, 100)),
      });
      return page(await rows("profiles", "list", query));
    },

    async findProfile(handle, platform) {
      const names = variants(handle);
      if (!names.length) return null;
      const query = new URLSearchParams({
        platform: `eq.${platform}`,
        handle: `in.(${names.map(pgIn).join(",")})`,
        limit: "10",
      });
      const found = await rows("profiles", "find", query);
      for (const variant of names) {
        const match = found.find((row) => row.fields.Handle === variant);
        if (match) return match;
      }
      return found[0] ?? null;
    },

    async findPostLink(handle, platform) {
      const names = variants(handle);
      if (!names.length) return undefined;
      const query = new URLSearchParams({
        platform: `eq.${platform}`,
        author: `in.(${names.map(pgIn).join(",")})`,
        limit: "20",
      });
      const found = await rows("posts", "find-link", query);
      for (const variant of names) {
        const match = found.find((row) => row.fields.Author === variant);
        const link = match?.fields.Link;
        if (typeof link === "string" && link.trim()) return link.trim();
      }
      return undefined;
    },

    async updateProfile(recordId, fields) {
      return patch("profiles", "update", recordId, fields);
    },
  };
}

function pgIn(value: string): string {
  if (/^[A-Za-z0-9_.:@+-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export const supabaseCatalog: Catalog = createSupabaseCatalog();

export async function fetchAllRows(
  table: TableName,
  namespace = "",
): Promise<AirtableRecord[]> {
  const { url, key } = await credentials(connectionsEnv());
  const out: AirtableRecord[] = [];
  for (let offset = 0; ; offset += 1000) {
    const query = new URLSearchParams({
      select: "id,fields,created_at",
      namespace: `eq.${namespace}`,
      limit: "1000",
      offset: String(offset),
    });
    const res = await fetch(`${url}${REST}/${table}?${query}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });
    if (!res.ok) throw new Error(`Supabase ${table} list: ${res.status}`);
    const data = (await res.json()) as Row[];
    out.push(...data.map(asRecord));
    if (data.length < 1000) break;
  }
  return out;
}

export async function deleteCatalogNamespace(namespace: string): Promise<void> {
  if (!namespace) throw new Error("Refusing to delete the live catalog namespace");
  const env = connectionsEnv();
  const { url, key } = await credentials(env);
  for (const table of ["media", "posts", "profiles"] as const) {
    const query = new URLSearchParams({ namespace: `eq.${namespace}` });
    const res = await fetch(`${url}${REST}/${table}?${query}`, {
      method: "DELETE",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "return=minimal",
      },
    });
    if (!res.ok) {
      throw new Error(`Supabase ${table} delete: ${res.status}`);
    }
  }
}

export async function upsertCatalogRecords(input: {
  table: TableName;
  records: AirtableRecord[];
  namespace?: string;
}): Promise<void> {
  const namespace = input.namespace ?? "";
  const { url, key } = await credentials(connectionsEnv());
  const used = new Set<string>();
  const rows = input.records.map((record) => {
    const fields = record.fields ?? {};
    const base = {
      id: record.id,
      namespace,
      fields,
      ...(record.createdTime ? { created_at: record.createdTime } : {}),
    };
    if (input.table === "profiles") {
      let key = profileKey(fields, record.id);
      if (used.has(key)) key = record.id;
      used.add(key);
      return { ...base, profile_key: key };
    }
    if (input.table === "posts") {
      let key = postKey(fields, record.id);
      if (used.has(key)) key = record.id;
      used.add(key);
      return { ...base, post_key: key };
    }
    let key = mediaKey(fields, record.id);
    if (used.has(key)) key = record.id;
    used.add(key);
    const postLink = Array.isArray(fields.Post) ? String(fields.Post[0] ?? "") : "";
    return {
      ...base,
      media_key: key,
      ...(postLink ? { post_id: postLink } : {}),
    };
  });
  const query = new URLSearchParams({ on_conflict: "id" });
  const res = await fetch(`${url}${REST}/${input.table}?${query}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    throw new Error(`Supabase ${input.table} upsert: ${res.status}`);
  }
}
