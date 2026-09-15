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
  "https://x.com/elonmusk/status/2088037519312994480?s=20";

async function tryPath(path, params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(
    `https://api.scrapecreators.com${path}?${qs}`,
    { headers: { "x-api-key": process.env.SCRAPECREATORS_API_KEY } },
  );
  const j = await res.json();
  return { status: res.status, path, j };
}

const post = await tryPath("/v1/twitter/tweet", { url });
writeFileSync(
  resolve(root, "scripts/last-x-raw.json"),
  JSON.stringify(post.j, null, 2),
);

const top = Object.keys(post.j || {});
const sample = JSON.stringify(post.j).slice(0, 1200);
console.log(
  JSON.stringify(
    {
      http: post.status,
      topKeys: top,
      success: post.j.success,
      error: post.j.error || post.j.message,
      sample,
    },
    null,
    2,
  ),
);

const profile = await tryPath("/v1/twitter/tweet", {
  url: "https://x.com/ElonMusk",
});
console.log(
  "\nPROFILE as tweet:",
  profile.status,
  profile.j.error || profile.j.message || profile.j.success,
  JSON.stringify(profile.j).slice(0, 300),
);
