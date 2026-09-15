#!/usr/bin/env node
import { readFileSync, existsSync, writeFileSync } from "node:fs";
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

const url =
  process.argv[2] ||
  "https://x.com/elonmusk/status/2099051728318660621?s=20";

const qs = new URLSearchParams({ url });
const res = await fetch(
  `https://api.scrapecreators.com/v1/twitter/tweet?${qs}`,
  { headers: { "x-api-key": process.env.SCRAPECREATORS_API_KEY } },
);
const j = await res.json();
writeFileSync(
  resolve(root, "scripts/last-x-retweet-raw.json"),
  JSON.stringify(j, null, 2),
);

function walk(obj, path = "", out = [], depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 10) return out;
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    const key = k.toLowerCase();
    if (
      key.includes("retweet") ||
      key.includes("quoted") ||
      key === "media" ||
      key === "card" ||
      key === "note_tweet"
    ) {
      out.push({
        path: p,
        type: Array.isArray(v) ? `array(${v.length})` : typeof v,
        preview: typeof v === "string" ? v.slice(0, 80) : undefined,
      });
    }
    if (
      typeof v === "string" &&
      (v.includes("video.twimg.com") ||
        v.includes("pbs.twimg.com/media") ||
        v.includes(".mp4"))
    ) {
      out.push({ path: p, type: "url", preview: v.slice(0, 100) });
    }
    if (typeof v === "object") walk(v, p, out, depth + 1);
  }
  return out;
}

const legacy = j.legacy || {};
console.log(
  JSON.stringify(
    {
      http: res.status,
      success: j.success,
      rest_id: j.rest_id,
      full_text: legacy.full_text,
      hasExtendedMedia: Boolean(legacy.extended_entities?.media?.length),
      mediaCount: legacy.extended_entities?.media?.length || 0,
      hasRetweeted: Boolean(
        legacy.retweeted_status_result || j.retweeted_status_result,
      ),
      hasQuoted: Boolean(j.quoted_status_result || legacy.quoted_status_result),
      topKeys: Object.keys(j),
      legacyKeys: Object.keys(legacy),
      hits: walk(j).slice(0, 60),
    },
    null,
    2,
  ),
);
