#!/usr/bin/env node
/**
 * Standalone E2E against deployed Cloudflare Worker.
 * Avoids ScrapeCreators feed/post scrapes by default (rate-limit safe).
 *
 *   API_URL=https://social-hub....workers.dev node scripts/e2e-cloud.mjs
 *   E2E_LIVE_SCRAPE=1  — also hit /api/recent-posts (costs credits)
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const results = [];

function loadEnv() {
  const p = resolve(root, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnv();

const API =
  process.env.API_URL ||
  "https://social-hub.kelvinchristian144.workers.dev";
const LIVE_SCRAPE = process.env.E2E_LIVE_SCRAPE === "1";

function record(name, ok, detail = "") {
  results.push({ name, ok, detail: String(detail).slice(0, 240) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function timed(fn) {
  const t0 = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t0 };
}

async function get(path, init) {
  return timed(() => fetch(`${API}${path}`, init));
}

console.log(`\n=== social-hub E2E (cloud) ===\nAPI: ${API}\nlive scrape: ${LIVE_SCRAPE}\n`);

// 1 Health
try {
  const { value: res, ms } = await get("/health");
  const body = await res.json();
  const ok =
    res.ok &&
    body.ok === true &&
    body.hasAirtable &&
    body.hasR2 &&
    body.hasScrapeCreators &&
    body.hasEventKey &&
    body.hasSigningKey;
  record(
    "1. GET /health (all secrets)",
    ok,
    `${ms}ms airtable=${body.hasAirtable} r2=${body.hasR2} sc=${body.hasScrapeCreators} inngest=${body.hasEventKey && body.hasSigningKey}`,
  );
} catch (e) {
  record("1. GET /health (all secrets)", false, e.message || e);
}

// 2 UI pages
for (const [path, label] of [
  ["/", "home"],
  ["/batch", "batch"],
  ["/scraps", "scraps"],
  ["/docs/api", "api docs"],
]) {
  try {
    const { value: res, ms } = await get(path);
    const text = await res.text();
    record(
      `2. UI ${label} (${path})`,
      res.ok && text.length > 200,
      `${ms}ms status=${res.status} bytes=${text.length}`,
    );
  } catch (e) {
    record(`2. UI ${label} (${path})`, false, e.message || e);
  }
}

// 3 Static assets
for (const path of ["/ui.css", "/batch.js", "/batch-store.js", "/theme.js"]) {
  try {
    const { value: res, ms } = await get(path);
    record(`3. Asset ${path}`, res.ok, `${ms}ms status=${res.status}`);
  } catch (e) {
    record(`3. Asset ${path}`, false, e.message || e);
  }
}

// 4 Airtable scraps (no scrape credits)
try {
  const { value: res, ms } = await get("/api/scraps?type=all");
  const body = await res.json();
  const count = Array.isArray(body.items)
    ? body.items.length
    : Array.isArray(body.posts)
      ? body.posts.length
      : Array.isArray(body.scraps)
        ? body.scraps.length
        : body.ok === true
          ? "ok"
          : 0;
  record(
    "4. GET /api/scraps (Airtable)",
    res.ok && body.ok !== false,
    `${ms}ms count=${count} keys=${Object.keys(body).slice(0, 8).join(",")}`,
  );
} catch (e) {
  record("4. GET /api/scraps (Airtable)", false, e.message || e);
}

// 5 Credits (cheap account call)
try {
  const { value: res, ms } = await get("/api/credits");
  const body = await res.json();
  record(
    "5. GET /api/credits",
    res.ok && body.ok === true && typeof body.remaining === "number",
    `${ms}ms remaining=${body.remaining} err=${body.error || ""}`,
  );
} catch (e) {
  record("5. GET /api/credits", false, e.message || e);
}

// 6 Thumb proxy (Twitter CDN sample — no ScrapeCreators)
try {
  const thumb =
    "https://pbs.twimg.com/profile_images/1683325380441128960/yRsRRjGO_400x400.jpg";
  const { value: res, ms } = await get(
    `/api/thumb?url=${encodeURIComponent(thumb)}`,
  );
  const ct = res.headers.get("content-type") || "";
  const buf = await res.arrayBuffer();
  record(
    "6. GET /api/thumb (proxy)",
    res.ok && ct.startsWith("image/") && buf.byteLength > 500,
    `${ms}ms status=${res.status} ct=${ct} bytes=${buf.byteLength}`,
  );
} catch (e) {
  record("6. GET /api/thumb (proxy)", false, e.message || e);
}

// 7 Inngest hello via Worker
try {
  const { value: res, ms } = await timed(() =>
    fetch(`${API}/demo/hello`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ who: "e2e-cloud" }),
    }),
  );
  const body = await res.json();
  record(
    "7. POST /demo/hello (Inngest)",
    res.ok && body.ok === true,
    `${ms}ms ids=${JSON.stringify(body.ids || body.error || "").slice(0, 120)}`,
  );
} catch (e) {
  record("7. POST /demo/hello (Inngest)", false, e.message || e);
}

// 8 Optional R2 save-sync with known media id (no scrape)
try {
  const payloadPath = resolve(root, "scripts/save-media-payload.json");
  const payload = existsSync(payloadPath)
    ? JSON.parse(readFileSync(payloadPath, "utf8"))
    : null;
  if (!payload?.mediaRecordId) {
    record("8. POST /api/media/save-sync", false, "no save-media-payload.json");
  } else {
    const { value: res, ms } = await timed(() =>
      fetch(`${API}/api/media/save-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, force: false }),
      }),
    );
    const body = await res.json().catch(() => ({}));
    const ok =
      res.ok &&
      (body.ok === true ||
        /already-saved|Saved copy/i.test(JSON.stringify(body)));
    record(
      "8. POST /api/media/save-sync (R2)",
      ok,
      `${ms}ms status=${res.status} ${JSON.stringify(body).slice(0, 160)}`,
    );
  }
} catch (e) {
  record("8. POST /api/media/save-sync (R2)", false, e.message || e);
}

// 9 Optional live scrape (off by default)
if (LIVE_SCRAPE) {
  try {
    const { value: res, ms } = await get(
      "/api/recent-posts?platform=x&handle=Tesla&limit=3&filter=media",
    );
    const body = await res.json();
    const n = Array.isArray(body.posts) ? body.posts.length : 0;
    record(
      "9. GET /api/recent-posts Tesla (LIVE)",
      res.ok && body.ok !== false && n > 0,
      `${ms}ms posts=${n} err=${body.error || ""}`,
    );
  } catch (e) {
    record("9. GET /api/recent-posts Tesla (LIVE)", false, e.message || e);
  }
} else {
  record(
    "9. GET /api/recent-posts (skipped)",
    true,
    "set E2E_LIVE_SCRAPE=1 to enable (uses credits)",
  );
}

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
const out = {
  at: new Date().toISOString(),
  api: API,
  passed,
  failed,
  results,
};
writeFileSync(
  resolve(root, "scripts/.e2e-cloud-last.json"),
  JSON.stringify(out, null, 2),
);

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
console.log("Wrote scripts/.e2e-cloud-last.json\n");
process.exit(failed ? 1 : 0);
