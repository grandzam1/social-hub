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

const url = process.argv[2] || "https://www.instagram.com/reel/DdO9A2EAt8g/";
const trim = process.argv.includes("--trim");
const qs = new URLSearchParams({
  url,
  include_play_count: "false",
});
if (trim) qs.set("trim", "true");
const res = await fetch(
  `https://api.scrapecreators.com/v1/instagram/post?${qs}`,
  { headers: { "x-api-key": process.env.SCRAPECREATORS_API_KEY } },
);
const j = await res.json();
writeFileSync(resolve(root, "scripts/last-ig-raw.json"), JSON.stringify(j, null, 2));
const keys = Object.keys(j);
const dataKeys = j.data ? Object.keys(j.data) : [];
const media = j.data?.xdt_shortcode_media;
console.log({
  status: res.status,
  topKeys: keys,
  dataKeys,
  hasMedia: Boolean(media),
  mediaKeys: media ? Object.keys(media).slice(0, 40) : [],
  shortcode: media?.shortcode,
  is_video: media?.is_video,
  video_url: Boolean(media?.video_url),
  display_url: Boolean(media?.display_url),
  owner: media?.owner?.username,
  success: j.success,
  error: j.error || j.message,
});
