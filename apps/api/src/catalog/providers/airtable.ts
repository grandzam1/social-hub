import { connectionsEnv } from "../../connections/runtime.js";
import { getAppSecret } from "../../connections/secrets.js";
import { recordAirtableRequest } from "../../lib/usage.js";
import type { AirtableRecord, Catalog } from "../types.js";

export type { AirtableRecord };

async function setting(name: string, fallback: string): Promise<string> {
  const value = (await getAppSecret(connectionsEnv(), name))?.trim();
  return value || fallback;
}

function baseId() {
  return setting("airtable_base_id", "appkPrLfwDGwIIbTL");
}

function mediaTable() {
  return setting("airtable_media_table", "tbly36b1qJiRbfEL2");
}

function postsTable() {
  return setting("airtable_posts_table", "tblxevZB9wCX1N3WF");
}

function profilesTable() {
  return setting("airtable_profiles_table", "tblD49NYtqd3vdOTI");
}

async function token() {
  const value = (await getAppSecret(connectionsEnv(), "airtable_token"))?.trim();
  if (!value) throw new Error("Missing env var: AIRTABLE_TOKEN");
  return value;
}

function errorCause(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.message];
  let cur: unknown = err.cause;
  for (let i = 0; i < 3 && cur; i++) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      cur = cur.cause;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return parts.join(" → ");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function airtableFetch(path: string, init?: RequestInit) {
  const method = init?.method ?? "GET";
  const url = `https://api.airtable.com/v0/${await baseId()}${path}`;
  const attempts = 3;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${await token()}`,
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
      // Track every attempt that received an HTTP response (including 429/5xx).
      recordAirtableRequest({
        method,
        path,
        status: res.status,
      });
      if (res.status === 429 || res.status >= 500) {
        const body = await res.text();
        lastErr = new Error(`Airtable ${method} ${path}: ${res.status} ${body}`);
        if (attempt < attempts) {
          await sleep(250 * attempt * attempt);
          continue;
        }
        throw lastErr;
      }
      if (!res.ok) {
        throw new Error(
          `Airtable ${method} ${path}: ${res.status} ${await res.text()}`,
        );
      }
      return res.json();
    } catch (err) {
      lastErr = err;
      const msg = errorCause(err);
      const retryable =
        /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket|network|429|5\d\d/i.test(
          msg,
        );
      if (!retryable || attempt >= attempts) {
        throw new Error(`Airtable ${method} ${path}: ${msg}`);
      }
      console.warn(
        `[airtable] retry ${attempt}/${attempts} ${method} ${path}: ${msg}`,
      );
      await sleep(250 * attempt * attempt);
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Airtable ${method} ${path}: ${errorCause(lastErr)}`);
}

function formulaEq(field: string, value: string) {
  const escaped = value.replace(/'/g, "\\'");
  return `{${field}}='${escaped}'`;
}

async function findOne(
  table: string,
  formula: string,
): Promise<AirtableRecord | null> {
  const qs = new URLSearchParams({
    filterByFormula: formula,
    maxRecords: "1",
  });
  const data = (await airtableFetch(`/${table}?${qs}`)) as {
    records: AirtableRecord[];
  };
  return data.records[0] ?? null;
}

export async function listRecords(
  table: string,
  options?: {
    pageSize?: number;
    offset?: string;
    sortField?: string;
    sortDir?: "asc" | "desc";
  },
): Promise<{ records: AirtableRecord[]; offset?: string }> {
  const qs = new URLSearchParams();
  qs.set("pageSize", String(options?.pageSize ?? 50));
  if (options?.offset) qs.set("offset", options.offset);
  if (options?.sortField) {
    qs.set("sort[0][field]", options.sortField);
    qs.set("sort[0][direction]", options.sortDir ?? "desc");
  }
  return (await airtableFetch(`/${table}?${qs}`)) as {
    records: AirtableRecord[];
    offset?: string;
  };
}

export async function listPosts(pageSize = 50) {
  try {
    return await listRecords(await postsTable(), {
      pageSize,
      sortField: "Scraped",
      sortDir: "desc",
    });
  } catch {
    return listRecords(await postsTable(), { pageSize });
  }
}

export async function listMedia(pageSize = 100) {
  return listRecords(await mediaTable(), { pageSize: Math.min(pageSize, 100) });
}

export async function listProfiles(pageSize = 100) {
  return listRecords(await profilesTable(), { pageSize: Math.min(pageSize, 100) });
}

async function createRecord(
  table: string,
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  return (await airtableFetch(`/${table}`, {
    method: "POST",
    body: JSON.stringify({ fields, typecast: true }),
  })) as AirtableRecord;
}

async function patchRecord(
  table: string,
  recordId: string,
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  return (await airtableFetch(`/${table}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields, typecast: true }),
  })) as AirtableRecord;
}

export async function getMedia(recordId: string): Promise<AirtableRecord> {
  return (await airtableFetch(
    `/${await mediaTable()}/${recordId}`,
  )) as AirtableRecord;
}

export async function updateMedia(
  recordId: string,
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  return patchRecord(await mediaTable(), recordId, fields);
}

export async function updatePost(
  recordId: string,
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  return patchRecord(await postsTable(), recordId, fields);
}

export async function getPost(recordId: string): Promise<AirtableRecord> {
  return (await airtableFetch(
    `/${await postsTable()}/${recordId}`,
  )) as AirtableRecord;
}

export async function listMediaForPost(
  postRecordId: string,
): Promise<AirtableRecord[]> {
  const post = await getPost(postRecordId);
  const linked = Array.isArray(post.fields.Files)
    ? (post.fields.Files as string[]).filter(Boolean)
    : [];
  // One media query for the whole carousel. One fetch per slide grows with the post.
  const formula = linked.length
    ? `OR(${linked.map((id) => `RECORD_ID()='${id.replace(/'/g, "\\'")}'`).join(",")})`
    : `FIND('${postRecordId.replace(/'/g, "\\'")}', ARRAYJOIN({Post}))`;
  const qs = new URLSearchParams({
    filterByFormula: formula,
    pageSize: "100",
  });
  const data = (await airtableFetch(`/${await mediaTable()}?${qs}`)) as {
    records: AirtableRecord[];
  };
  return [...data.records].sort(
    (a, b) => Number(a.fields.Order ?? 0) - Number(b.fields.Order ?? 0),
  );
}

export async function findPostLink(
  handle: string,
  platform: string,
): Promise<string | undefined> {
  const bare = handle.replace(/^@/, "").trim();
  const variants = [...new Set([handle.trim(), bare, `@${bare}`].filter(Boolean))];
  for (const variant of variants) {
    const found = await findOne(
      await postsTable(),
      `AND(${formulaEq("Author", variant)},${formulaEq("Platform", platform)})`,
    );
    const link = found?.fields.Link;
    if (typeof link === "string" && link.trim()) return link.trim();
  }
  return undefined;
}

export async function findProfile(
  handle: string,
  platform: string,
): Promise<AirtableRecord | null> {
  const bare = handle.replace(/^@/, "").trim();
  const variants = [...new Set([handle.trim(), bare, `@${bare}`].filter(Boolean))];
  for (const variant of variants) {
    const found = await findOne(
      await profilesTable(),
      `AND(${formulaEq("Handle", variant)},${formulaEq("Platform", platform)})`,
    );
    if (found) return found;
  }
  return null;
}

export async function updateProfile(
  recordId: string,
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  return patchRecord(await profilesTable(), recordId, fields);
}

export async function upsertProfile(
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  const handle = String(fields.Handle ?? "");
  const platform = String(fields.Platform ?? "");
  if (handle && platform) {
    const existing = await findOne(
      await profilesTable(),
      `AND(${formulaEq("Handle", handle)},${formulaEq("Platform", platform)})`,
    );
    if (existing) {
      return patchRecord(await profilesTable(), existing.id, fields);
    }
  }
  return createRecord(await profilesTable(), fields);
}

export async function upsertPost(
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  const postId = String(fields["Post ID"] ?? "");
  if (postId) {
    const existing = await findOne(await postsTable(), formulaEq("Post ID", postId));
    if (existing) {
      return patchRecord(await postsTable(), existing.id, fields);
    }
  }
  return createRecord(await postsTable(), fields);
}

export async function upsertMedia(
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  const mediaId = String(fields["Media ID"] ?? "");
  if (mediaId) {
    const existing = await findOne(
      await mediaTable(),
      formulaEq("Media ID", mediaId),
    );
    if (existing) {
      // Keep existing Saved copy unless caller overwrites
      const merged = { ...fields };
      if (!merged["Saved copy"] && existing.fields["Saved copy"]) {
        delete merged["Saved copy"];
      }
      return patchRecord(await mediaTable(), existing.id, merged);
    }
  }
  return createRecord(await mediaTable(), fields);
}

export const airtableCatalog: Catalog = {
  upsertProfile,
  upsertPost,
  upsertMedia,
  getPost,
  getMedia,
  listMediaForPost,
  updatePost,
  updateMedia,
  listPosts,
  listMedia,
  listProfiles,
  findProfile,
  findPostLink,
  updateProfile,
};
