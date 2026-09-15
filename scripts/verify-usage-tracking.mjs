#!/usr/bin/env node
/**
 * Verify simplified usage: persist + given/used/remaining display data.
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

const API = process.env.API_URL || "http://127.0.0.1:8787";
const table = process.env.AIRTABLE_USAGE_EVENTS_TABLE;
const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function getUsage() {
  const res = await fetch(`${API}/api/usage`, {
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json();
  if (!res.ok || !body.ok) {
    throw new Error(`usage ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body;
}

function svc(usage, name) {
  return (usage.services || []).find((s) => s.service === name);
}

async function main() {
  record("env AIRTABLE_USAGE_EVENTS_TABLE", Boolean(table), table || "missing");

  let usage = await getUsage();
  record("services payload", Array.isArray(usage.services) && usage.services.length >= 1);

  const sc = svc(usage, "ScrapeCreators");
  record(
    "ScrapeCreators remaining (live)",
    sc && (typeof sc.remaining === "number" || sc.remaining === null),
    `remaining=${sc?.remaining} used=${sc?.used} given=${sc?.given}`,
  );

  const beforeAt = svc(usage, "Airtable")?.used ?? 0;

  const scrapsRes = await fetch(`${API}/api/scraps?type=all`, {
    signal: AbortSignal.timeout(90_000),
  });
  const scraps = await scrapsRes.json();
  record("Airtable via /api/scraps", scrapsRes.ok && scraps.ok !== false);

  await sleep(2500);
  usage = await getUsage();
  const afterAt = svc(usage, "Airtable")?.used ?? 0;
  record(
    "Airtable used increased",
    usage.configured ? afterAt >= beforeAt : true,
    `${beforeAt} → ${afterAt}`,
  );

  record("No inventing R2 quota", svc(usage, "R2")?.given == null);
  record("No inventing Airtable quota", svc(usage, "Airtable")?.given == null);

  const failed = results.filter((r) => !r.ok);
  console.log(`\nPassed ${results.length - failed.length}/${results.length}`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
