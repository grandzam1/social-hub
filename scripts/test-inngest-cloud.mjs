#!/usr/bin/env node
/**
 * Proves Inngest Cloud credentials work from WSL.
 * Event ingest succeeds even before an app is synced.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const p = resolve(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnv();

const eventKey = process.env.INNGEST_EVENT_KEY;
if (!eventKey) {
  console.error("Missing INNGEST_EVENT_KEY in .env");
  process.exit(1);
}

const payload = {
  name: "social/hello",
  data: {
    who: "cloud-key-test",
    source: "scripts/test-inngest-cloud.mjs",
    at: new Date().toISOString(),
  },
};

const res = await fetch("https://inn.gs/e/" + eventKey, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

const text = await res.text();
console.log("status", res.status);
console.log(text);
if (!res.ok) process.exit(1);
console.log("Cloud event ingest OK. If no function runs, sync apps/api first.");
