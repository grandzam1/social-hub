#!/usr/bin/env node
/**
 * E2E battle suite for social-hub (local Hono + Inngest Dev + ScrapeCreators + Cloud keys).
 * Airtable in-app write skipped unless AIRTABLE_API_KEY is set (use Composio for that leg).
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
    const v = t.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark}  ${name}${detail ? " — " + detail : ""}`);
}

async function timed(fn) {
  const t0 = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t0 };
}

loadEnv();

const API = process.env.API_URL || "http://127.0.0.1:8787";
const DEV = process.env.INNGEST_DEV_URL || "http://127.0.0.1:8288";
const SC_KEY = process.env.SCRAPECREATORS_API_KEY;
const EVENT_KEY = process.env.INNGEST_EVENT_KEY;

console.log("\n=== social-hub E2E battle ===\n");

// 1) Health
try {
  const { value: res, ms } = await timed(() => fetch(`${API}/health`));
  const body = await res.json();
  record(
    "1. Hono /health",
    res.ok && body.ok === true,
    `${ms}ms keys event=${body.hasEventKey} signing=${body.hasSigningKey}`,
  );
} catch (e) {
  record("1. Hono /health", false, String(e.message || e));
}

// 2) Inngest Dev UI up
try {
  const { value: res, ms } = await timed(() => fetch(DEV + "/"));
  record("2. Inngest Dev Server", res.ok || res.status === 200, `${ms}ms status=${res.status}`);
} catch (e) {
  record("2. Inngest Dev Server", false, String(e.message || e));
}

// 3) Cloud event ingest
try {
  const { value: res, ms } = await timed(() =>
    fetch("https://inn.gs/e/" + EVENT_KEY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "social/hello",
        data: { who: "e2e-cloud", at: new Date().toISOString() },
      }),
    }),
  );
  const text = await res.text();
  record("3. Cloud event ingest", res.ok, `${ms}ms ${text.slice(0, 120)}`);
} catch (e) {
  record("3. Cloud event ingest", false, String(e.message || e));
}

// 4) Local hello (queue + function)
let helloIds = null;
try {
  const { value: res, ms } = await timed(() =>
    fetch(`${API}/demo/hello`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ who: "e2e-local" }),
    }),
  );
  const body = await res.json();
  helloIds = body.ids;
  record("4. Local Inngest hello send", res.ok && body.ok, `${ms}ms ${JSON.stringify(body).slice(0, 140)}`);
} catch (e) {
  record("4. Local Inngest hello send", false, String(e.message || e));
}

// 5) Wait and confirm event landed in Dev Server
await new Promise((r) => setTimeout(r, 1500));
try {
  const { value: res, ms } = await timed(() => fetch(`${DEV}/v1/events`));
  const body = await res.json();
  const events = body.data || body.events || [];
  const found = events.some(
    (e) => e.name === "social/hello" && e.data?.who === "e2e-local",
  );
  record(
    "5. Dev Server received social/hello",
    found,
    `${ms}ms events=${events.length}`,
  );
} catch (e) {
  record("5. Dev Server received social/hello", false, String(e.message || e));
}

// 6) Concurrency burst
try {
  const { value: settled, ms } = await timed(() =>
    Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        fetch(`${API}/demo/hello`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ who: `burst-${i}` }),
        }).then(async (r) => ({ status: r.status, body: await r.json() })),
      ),
    ),
  );
  const okCount = settled.filter((s) => s.status === 200 && s.body.ok).length;
  record("6. Concurrency x8 hello", okCount === 8, `${ms}ms ok=${okCount}/8`);
} catch (e) {
  record("6. Concurrency x8 hello", false, String(e.message || e));
}

// 7) ScrapeCreators credit balance
async function scGet(path) {
  const res = await fetch(`https://api.scrapecreators.com${path}`, {
    headers: { "x-api-key": SC_KEY },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { res, json };
}

try {
  const { value, ms } = await timed(() => scGet("/v1/account/credit-balance"));
  const credits = value.json.creditCount ?? value.json.credits_remaining;
  record(
    "7. ScrapeCreators credit balance",
    value.res.ok && typeof credits === "number",
    `${ms}ms credits=${credits}`,
  );
} catch (e) {
  record("7. ScrapeCreators credit balance", false, String(e.message || e));
}

// 8) Real TikTok video scrape (1 credit if uncached)
const scrapePayload = { platform: null, post: null };
try {
  const url =
    "https://www.tiktok.com/@stoolpresidente/video/7517114944362499342";
  const { value, ms } = await timed(() =>
    scGet(`/v2/tiktok/video?url=${encodeURIComponent(url)}&cache_max_age=30d`),
  );
  const aweme = value.json.aweme_detail;
  const ok = value.res.ok && Boolean(aweme?.aweme_id);
  if (ok) {
    scrapePayload.platform = "tiktok";
    scrapePayload.post = {
      platformPostId: aweme.aweme_id,
      caption: aweme.desc || "",
      likes: aweme.statistics?.digg_count ?? 0,
      comments: aweme.statistics?.comment_count ?? 0,
      shares: aweme.statistics?.share_count ?? 0,
      saves: aweme.statistics?.collect_count ?? 0,
      views: aweme.statistics?.play_count ?? 0,
      url,
      author: aweme.author?.unique_id || aweme.author?.uniqueId || "stoolpresidente",
    };
  }
  record(
    "8. ScrapeCreators TikTok video",
    ok,
    `${ms}ms id=${aweme?.aweme_id || "n/a"} cached=${value.json.cached === true}`,
  );
} catch (e) {
  record("8. ScrapeCreators TikTok video", false, String(e.message || e));
}

// 9) Real X tweet scrape
try {
  const url = "https://x.com/Austen/status/1935730646267158797";
  const { value, ms } = await timed(() =>
    scGet(`/v1/twitter/tweet?url=${encodeURIComponent(url)}&cache_max_age=30d`),
  );
  const ok = value.res.ok && Boolean(value.json.rest_id || value.json.legacy);
  record(
    "9. ScrapeCreators X tweet",
    ok,
    `${ms}ms id=${value.json.rest_id || "n/a"}`,
  );
} catch (e) {
  record("9. ScrapeCreators X tweet", false, String(e.message || e));
}

// 10) Instagram post scrape
try {
  const url = "https://www.instagram.com/reel/DLDXI0fylTC/";
  const { value, ms } = await timed(() =>
    scGet(`/v1/instagram/post?url=${encodeURIComponent(url)}&cache_max_age=30d`),
  );
  const media = value.json.data?.xdt_shortcode_media;
  const ok = value.res.ok && Boolean(media?.shortcode || media?.id);
  record(
    "10. ScrapeCreators Instagram post",
    ok,
    `${ms}ms shortcode=${media?.shortcode || "n/a"}`,
  );
} catch (e) {
  record("10. ScrapeCreators Instagram post", false, String(e.message || e));
}

// 11) Airtable PAT (optional)
const hasAirtablePat = Boolean(process.env.AIRTABLE_API_KEY);
record(
  "11. Airtable PAT in .env",
  hasAirtablePat,
  hasAirtablePat
    ? "will write via REST"
    : "MISSING — Composio leg used by agent instead",
);

if (hasAirtablePat && scrapePayload.post) {
  try {
    const base = process.env.AIRTABLE_BASE_ID;
    const { value: res, ms } = await timed(() =>
      fetch(`https://api.airtable.com/v0/${base}/Posts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          typecast: true,
          records: [
            {
              fields: {
                "Post ID": scrapePayload.post.platformPostId,
                Platform: scrapePayload.platform,
                Author: scrapePayload.post.author,
                Text: scrapePayload.post.caption,
                Link: scrapePayload.post.url,
                Likes: scrapePayload.post.likes,
                Comments: scrapePayload.post.comments,
                Shares: scrapePayload.post.shares,
                Views: scrapePayload.post.views,
                Title: `@${scrapePayload.post.author} — e2e`,
                Status: "Media ready",
                "Post type": "Video",
              },
            },
          ],
        }),
      }),
    );
    const body = await res.json();
    record(
      "12. Airtable REST upsert",
      res.ok && Array.isArray(body.records),
      `${ms}ms ${JSON.stringify(body).slice(0, 160)}`,
    );
  } catch (e) {
    record("12. Airtable REST upsert", false, String(e.message || e));
  }
} else {
  record(
    "12. Airtable REST upsert",
    false,
    "skipped — need AIRTABLE_API_KEY (Personal Access Token)",
  );
}

// Persist scrape payload for Composio follow-up
const out = resolve(root, "scripts/.e2e-last.json");
writeFileSync(
  out,
  JSON.stringify({ at: new Date().toISOString(), helloIds, scrapePayload, results }, null, 2),
);

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
console.log(`\n=== summary: ${passed} passed, ${failed} failed ===`);
console.log(`Wrote ${out}`);
process.exit(failed > 0 && failed === results.length ? 1 : 0);
