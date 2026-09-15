#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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
const res = await fetch(`https://api.airtable.com/v0/meta/bases/${base}/tables`, {
  headers: { Authorization: `Bearer ${token}` },
});
const data = await res.json();
if (!res.ok) {
  console.error(data);
  process.exit(1);
}
for (const t of data.tables) {
  console.log("\nTABLE", t.name, t.id);
  for (const f of t.fields) console.log(" ", f.name, "|", f.type);
}
