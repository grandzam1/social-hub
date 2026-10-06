import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listRecords } from "../src/catalog/providers/airtable.js";
import {
  fetchAllRows,
  upsertCatalogRecords,
} from "../src/catalog/providers/supabase.js";
import type { AirtableRecord } from "../src/catalog/types.js";

config({
  path: resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../.env"),
});

const dryRun = process.argv.includes("--dry-run");

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function stable(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}

async function listAll(table: string): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const page = await listRecords(table, { pageSize: 100, offset });
    records.push(...page.records);
    offset = page.offset;
  } while (offset);
  return records;
}

function linkMedia(posts: AirtableRecord[], media: AirtableRecord[]): {
  records: AirtableRecord[];
  rebuilt: number;
} {
  const owner = new Map<string, string>();
  for (const post of posts) {
    const files = Array.isArray(post.fields.Files) ? post.fields.Files : [];
    for (const id of files) {
      if (typeof id === "string" && id && !owner.has(id)) owner.set(id, post.id);
    }
  }
  let rebuilt = 0;
  const records = media.map((record) => {
    const linked = Array.isArray(record.fields.Post)
      ? record.fields.Post.filter((id) => typeof id === "string" && id)
      : [];
    if (linked.length) return record;
    const postId = owner.get(record.id);
    if (!postId) return record;
    rebuilt += 1;
    return { ...record, fields: { ...record.fields, Post: [postId] } };
  });
  return { records, rebuilt };
}

async function migrateTable(
  label: string,
  supabaseTable: "profiles" | "posts" | "media",
  source: AirtableRecord[],
) {
  const existing = await fetchAllRows(supabaseTable);
  const byId = new Map(existing.map((row) => [row.id, row]));
  const pending: AirtableRecord[] = [];
  let skipped = 0;
  for (const record of source) {
    const current = byId.get(record.id);
    if (current && stable(current.fields) === stable(record.fields)) skipped += 1;
    else pending.push(record);
  }

  let written = 0;
  let failed = 0;
  if (!dryRun) {
    for (const record of pending) {
      try {
        await upsertCatalogRecords({ table: supabaseTable, records: [record] });
        written += 1;
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : "error";
        console.log(`${label} failed ${record.id}: ${message}`);
      }
    }
  }

  console.log(
    `${label} read=${source.length} written=${written} skipped=${skipped} failed=${failed}${
      dryRun ? ` pending=${pending.length}` : ""
    }`,
  );
}

const profiles = await listAll(required("AIRTABLE_PROFILES_TABLE"));
const posts = await listAll(required("AIRTABLE_POSTS_TABLE"));
const media = linkMedia(posts, await listAll(required("AIRTABLE_MEDIA_TABLE")));
console.log(dryRun ? "dry-run" : "migrate");
console.log(`media links rebuilt=${media.rebuilt}`);
await migrateTable("profiles", "profiles", profiles);
await migrateTable("posts", "posts", posts);
await migrateTable("media", "media", media.records);
