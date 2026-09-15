#!/usr/bin/env node
/**
 * Standalone automation — call social-hub API to save CDN media → R2.
 *
 * Usage:
 *   node scripts/automate-save-media.mjs --id recXXXX [--sync] [--force]
 *   node scripts/automate-save-media.mjs --id recXXXX --url https://cdn.../video.mp4
 *
 * Env:
 *   API_URL=http://127.0.0.1:8787
 */
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    id: { type: "string" },
    url: { type: "string" },
    post: { type: "string" },
    key: { type: "string" },
    type: { type: "string" },
    sync: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    api: { type: "string" },
  },
});

const api = values.api || process.env.API_URL || "http://127.0.0.1:8787";
const mediaRecordId = values.id;

if (!mediaRecordId) {
  console.error(
    "Usage: node scripts/automate-save-media.mjs --id <airtableMediaRecordId> [--sync] [--force]",
  );
  process.exit(1);
}

const path = values.sync ? "/api/media/save-sync" : "/api/media/save";
const body = {
  mediaRecordId,
  postRecordId: values.post,
  fileUrl: values.url,
  objectKey: values.key,
  mediaType: values.type,
  force: values.force,
};

const res = await fetch(`${api}${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const text = await res.text();
console.log(res.status, text);
if (!res.ok) process.exit(1);
