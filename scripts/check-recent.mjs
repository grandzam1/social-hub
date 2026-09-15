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
const posts = process.env.AIRTABLE_POSTS_TABLE || "tblxevZB9wCX1N3WF";
const media = process.env.AIRTABLE_MEDIA_TABLE || "tbly36b1qJiRbfEL2";

async function list(table, label) {
  const qs = new URLSearchParams({
    pageSize: "5",
    "sort[0][field]": label === "posts" ? "Scraped" : "Media ID",
    "sort[0][direction]": "desc",
  });
  // Media may not sort by Scraped — use createdTime
  const url =
    label === "media"
      ? `https://api.airtable.com/v0/${base}/${media}?pageSize=5&sort%5B0%5D%5Bfield%5D=Order&sort%5B0%5D%5Bdirection%5D=desc`
      : `https://api.airtable.com/v0/${base}/${posts}?${qs}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await res.json();
  if (!res.ok) {
    // fallback without sort
    const res2 = await fetch(
      `https://api.airtable.com/v0/${base}/${table}?pageSize=8`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return res2.json();
  }
  return j;
}

const [p, m] = await Promise.all([
  list(posts, "posts"),
  fetch(`https://api.airtable.com/v0/${base}/${media}?pageSize=8`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json()),
]);

console.log("=== Recent Posts ===");
for (const r of p.records || []) {
  const f = r.fields || {};
  console.log({
    id: r.id,
    created: r.createdTime,
    postId: f["Post ID"],
    author: f.Author,
    status: f.Status,
    mediaCount: f["Media count"],
    files: f.Files,
    link: f.Link,
    text: String(f.Text || "").slice(0, 60),
  });
}

console.log("\n=== Recent Media ===");
const mediaRows = [...(m.records || [])].sort((a, b) =>
  String(b.createdTime).localeCompare(String(a.createdTime)),
);
for (const r of mediaRows.slice(0, 8)) {
  const f = r.fields || {};
  console.log({
    id: r.id,
    created: r.createdTime,
    mediaId: f["Media ID"],
    order: f.Order,
    type: f.Type,
    fileStatus: f["File status"],
    hasFileLink: Boolean(f["File link"]),
    hasSaved: Boolean(f["Saved copy"]),
    saved: String(f["Saved copy"] || "").slice(0, 70),
    post: f.Post,
  });
}
