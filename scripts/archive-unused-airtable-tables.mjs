#!/usr/bin/env node
/**
 * Backup then remove unused Airtable tables.
 *
 * Targets (exact names only): "X Posts Import", "Table 1", "runs".
 * Writes one JSON file per table under backups/airtable/, then deletes
 * the table. If the token cannot delete tables, deletes every row instead.
 *
 * Usage (from repo root, .env loaded automatically):
 *   node scripts/archive-unused-airtable-tables.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TARGETS = ["X Posts Import", "Table 1", "runs"];

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

const base = process.env.AIRTABLE_BASE_ID;
const token = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY;
if (!base || !token) {
  console.error("Need AIRTABLE_BASE_ID and AIRTABLE_TOKEN (or AIRTABLE_API_KEY)");
  process.exit(1);
}

const outDir = resolve(root, "backups", "airtable");
mkdirSync(outDir, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function airtable(url, init = {}) {
  const attempts = 5;
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (res.status === 429 || res.status >= 500) {
      const body = await res.text();
      lastErr = new Error(`${res.status} ${body}`);
      if (attempt < attempts) {
        await sleep(300 * attempt * attempt);
        continue;
      }
      throw lastErr;
    }
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }
    if (!res.ok) {
      const err = new Error(
        `${init.method || "GET"} ${res.status} ${text || res.statusText}`,
      );
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }
  throw lastErr;
}

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function listTables() {
  const data = await airtable(
    `https://api.airtable.com/v0/meta/bases/${base}/tables`,
  );
  return data.tables ?? [];
}

async function fetchAllRecords(tableId) {
  const records = [];
  let offset;
  do {
    const qs = new URLSearchParams({ pageSize: "100" });
    if (offset) qs.set("offset", offset);
    const page = await airtable(
      `https://api.airtable.com/v0/${base}/${tableId}?${qs}`,
    );
    records.push(...(page.records ?? []));
    offset = page.offset;
  } while (offset);
  return records;
}

async function deleteTable(tableId) {
  return airtable(
    `https://api.airtable.com/v0/meta/bases/${base}/tables/${tableId}`,
    { method: "DELETE" },
  );
}

async function deleteAllRecords(tableId, records) {
  const ids = records.map((r) => r.id);
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const qs = new URLSearchParams();
    for (const id of chunk) qs.append("records[]", id);
    const data = await airtable(
      `https://api.airtable.com/v0/${base}/${tableId}?${qs}`,
      { method: "DELETE" },
    );
    deleted += (data.records ?? []).filter((r) => r.deleted).length;
    if (i + 10 < ids.length) await sleep(220);
  }
  return deleted;
}

const tables = await listTables();
const byName = new Map(tables.map((t) => [t.name, t]));

for (const name of TARGETS) {
  const table = byName.get(name);
  if (!table) {
    console.log(`skip  ${name} — not in this base`);
    continue;
  }

  console.log(`fetch ${name} (${table.id})`);
  const records = await fetchAllRecords(table.id);
  const backup = {
    exportedAt: new Date().toISOString(),
    baseId: base,
    table: {
      id: table.id,
      name: table.name,
      fields: (table.fields ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
      })),
    },
    recordCount: records.length,
    records,
  };
  const file = resolve(outDir, `${slug(name)}.json`);
  if (existsSync(file)) {
    const prev = JSON.parse(readFileSync(file, "utf8"));
    const prevCount = Number(prev.recordCount ?? prev.records?.length ?? 0);
    if (prevCount > records.length) {
      console.log(
        `keep existing backup (${prevCount} records); not replacing it with ${records.length}`,
      );
    } else {
      writeFileSync(file, JSON.stringify(backup, null, 2));
      console.log(`saved ${records.length} records → ${file}`);
    }
  } else {
    writeFileSync(file, JSON.stringify(backup, null, 2));
    console.log(`saved ${records.length} records → ${file}`);
  }

  try {
    const result = await deleteTable(table.id);
    console.log(
      `deleted table ${name} (${result?.id || table.id})`,
    );
  } catch (err) {
    console.warn(
      `table delete failed for ${name}: ${err.message}. Deleting rows instead.`,
    );
    const deleted = await deleteAllRecords(table.id, records);
    console.log(`deleted ${deleted} rows in ${name}`);
  }
}

const after = await listTables();
const left = after.filter((t) => TARGETS.includes(t.name));
if (!left.length) {
  console.log("done. none of the three tables remain in the base.");
} else {
  for (const table of left) {
    const page = await airtable(
      `https://api.airtable.com/v0/${base}/${table.id}?pageSize=1`,
    );
    const n = (page.records ?? []).length;
    const more = page.offset ? " or more" : "";
    console.log(
      n === 0
        ? `empty shell remains: ${table.name} (${table.id}) — delete it in the Airtable UI`
        : `rows remain: ${table.name} (${table.id}) has ${n}${more}`,
    );
  }
}
