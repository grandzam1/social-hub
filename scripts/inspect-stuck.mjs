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
const mediaTable = process.env.AIRTABLE_MEDIA_TABLE || "tbly36b1qJiRbfEL2";
const postsTable = process.env.AIRTABLE_POSTS_TABLE || "tblxevZB9wCX1N3WF";

const postId = process.argv[2] || "rec5QyoZOWhtkjxlG";
const mediaId = process.argv[3] || "recwyRguqCmY8F1MQ";

async function get(table, id) {
  const res = await fetch(`https://api.airtable.com/v0/${base}/${table}/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, ...(await res.json()) };
}

const post = await get(postsTable, postId);
const media = await get(mediaTable, mediaId);

console.log("POST", {
  http: post.status,
  id: post.id,
  status: post.fields?.Status,
  mediaCount: post.fields?.["Media count"],
  files: post.fields?.Files,
  link: post.fields?.Link,
  text: String(post.fields?.Text || "").slice(0, 100),
});

console.log("MEDIA", {
  http: media.status,
  id: media.id,
  mediaId: media.fields?.["Media ID"],
  order: media.fields?.Order,
  type: media.fields?.Type,
  fileStatus: media.fields?.["File status"],
  fileLink: String(media.fields?.["File link"] || "").slice(0, 120),
  savedCopy: media.fields?.["Saved copy"],
  post: media.fields?.Post,
  error: media.error,
});

// Try completing save via sync API
console.log("\nRetrying save-sync…");
const t0 = Date.now();
const res = await fetch("http://127.0.0.1:8787/api/media/save-sync", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    mediaRecordId: mediaId,
    postRecordId: postId,
    force: true,
  }),
});
const body = await res.text();
console.log({ http: res.status, ms: Date.now() - t0, body: body.slice(0, 800) });
