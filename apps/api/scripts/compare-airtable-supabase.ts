import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listMediaForPost, listRecords } from "../src/catalog/providers/airtable.js";
import { createSupabaseCatalog, fetchAllRows } from "../src/catalog/providers/supabase.js";
import type { AirtableRecord } from "../src/catalog/types.js";

config({
  path: resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../.env"),
});

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

function preview(value: unknown): string {
  return stable(value)
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/sb_publishable_[A-Za-z0-9_-]+/g, "[redacted]")
    .slice(0, 140);
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

function pick(ids: string[], count: number): string[] {
  const copy = [...ids];
  let seed = 20261005;
  for (let i = copy.length - 1; i > 0; i -= 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    const swap = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = swap;
  }
  return copy.slice(0, Math.min(count, copy.length));
}

function fieldDiffs(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const diffs: string[] = [];
  for (const key of [...keys].sort()) {
    if (stable(left[key]) !== stable(right[key])) {
      diffs.push(`${key} airtable=${preview(left[key])} supabase=${preview(right[key])}`);
    }
  }
  return diffs;
}

const tables = [
  ["profiles", required("AIRTABLE_PROFILES_TABLE"), "profiles"],
  ["posts", required("AIRTABLE_POSTS_TABLE"), "posts"],
  ["media", required("AIRTABLE_MEDIA_TABLE"), "media"],
] as const;

let differences = 0;
for (const [label, airtableTable, supabaseTable] of tables) {
  const airtable = await listAll(airtableTable);
  const supabase = await fetchAllRows(supabaseTable);
  const same = airtable.length === supabase.length;
  if (!same) differences += 1;
  console.log(
    `${label} airtable=${airtable.length} supabase=${supabase.length} ${same ? "match" : "DIFFER"}`,
  );
}

const airtablePosts = await listAll(required("AIRTABLE_POSTS_TABLE"));
const supabasePosts = new Map((await fetchAllRows("posts")).map((row) => [row.id, row]));
const sample = pick(airtablePosts.map((row) => row.id), 20);
const catalog = createSupabaseCatalog();
console.log(`sampled posts=${sample.length}`);

for (const id of sample) {
  const airtable = airtablePosts.find((row) => row.id === id);
  const supabase = supabasePosts.get(id);
  if (!airtable || !supabase) {
    differences += 1;
    console.log(`post ${id} missing side`);
    continue;
  }
  const diffs = fieldDiffs(airtable.fields, supabase.fields);
  const airtableSlides = await listMediaForPost(id);
  const supabaseSlides = await catalog.listMediaForPost(id);
  const orderMatch =
    airtableSlides.length === supabaseSlides.length &&
    airtableSlides.every((row, index) => row.id === supabaseSlides[index]?.id);
  if (diffs.length || !orderMatch) {
    differences += 1;
    console.log(
      `post ${id} fieldDiffs=${diffs.length} slides airtable=${airtableSlides.length} supabase=${supabaseSlides.length} order=${orderMatch ? "match" : "DIFFER"}`,
    );
    for (const diff of diffs) console.log(`  ${diff}`);
    if (!orderMatch) {
      console.log(`  airtable order=${airtableSlides.map((row) => row.id).join(",")}`);
      console.log(`  supabase order=${supabaseSlides.map((row) => row.id).join(",")}`);
    }
  }
}

console.log(differences === 0 ? "compare ok" : `compare differences=${differences}`);
process.exitCode = differences === 0 ? 0 : 1;
