/**
 * Tiny R2 upload to verify upload_bytes usage events without Airtable getMedia.
 * Run: npx tsx scripts/verify-r2-usage-upload.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { uploadToR2 } from "../apps/api/src/lib/r2.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

const key = `social-hub/usage-verify/${Date.now()}.txt`;
const body = Buffer.from(`usage-verify ${new Date().toISOString()}\n`);
const result = await uploadToR2({
  key,
  body,
  contentType: "text/plain",
});
console.log(JSON.stringify({ ok: true, ...result }));
