#!/usr/bin/env node
/**
 * Create Airtable table `usage_events` via Meta API and print its id.
 * Usage: node scripts/create-usage-events-table.mjs
 */
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
if (!base || !token) {
  console.error("Need AIRTABLE_BASE_ID and AIRTABLE_TOKEN (or AIRTABLE_API_KEY)");
  process.exit(1);
}

const existing = await fetch(
  `https://api.airtable.com/v0/meta/bases/${base}/tables`,
  { headers: { Authorization: `Bearer ${token}` } },
);
const existingBody = await existing.json();
if (!existing.ok) {
  console.error(existingBody);
  process.exit(1);
}

const found = (existingBody.tables || []).find(
  (t) => t.name === "usage_events" || t.name === "Usage events",
);
if (found) {
  console.log(`Already exists: ${found.name} → ${found.id}`);
  console.log(`Add to .env:\nAIRTABLE_USAGE_EVENTS_TABLE=${found.id}`);
  process.exit(0);
}

const choices = (names) => names.map((name) => ({ name }));

const body = {
  name: "usage_events",
  description: "Append-only usage ledger (Airtable calls, R2 bytes, SC credit snapshots)",
  fields: [
    // Primary field must be singleLineText (not singleSelect).
    { name: "Label", type: "singleLineText" },
    {
      name: "Service",
      type: "singleSelect",
      options: {
        choices: choices(["airtable", "r2", "scrapecreators"]),
      },
    },
    {
      name: "Metric",
      type: "singleSelect",
      options: {
        choices: choices([
          "api_request",
          "upload_bytes",
          "credit_snapshot",
        ]),
      },
    },
    { name: "Delta", type: "number", options: { precision: 0 } },
    {
      name: "Unit",
      type: "singleSelect",
      options: { choices: choices(["count", "bytes", "credits"]) },
    },
    { name: "Path", type: "singleLineText" },
    { name: "Method", type: "singleLineText" },
    { name: "Status Code", type: "number", options: { precision: 0 } },
    { name: "Detail", type: "multilineText" },
    {
      name: "Occurred At",
      type: "dateTime",
      options: {
        dateFormat: { name: "iso" },
        timeFormat: { name: "24hour" },
        timeZone: "utc",
      },
    },
  ],
};

const res = await fetch(
  `https://api.airtable.com/v0/meta/bases/${base}/tables`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  },
);
const data = await res.json();
if (!res.ok) {
  console.error(data);
  process.exit(1);
}

console.log(`Created: ${data.name} → ${data.id}`);
console.log(`Add to .env:\nAIRTABLE_USAGE_EVENTS_TABLE=${data.id}`);
console.log(
  "Also set the same var on the Cloudflare Worker if you deploy the API.",
);
