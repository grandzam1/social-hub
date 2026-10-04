import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { configure, envvars } from "@trigger.dev/sdk";

const envPath = resolve(process.cwd(), "../../.env");
const parsed = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const secretKey = process.env.TRIGGER_SECRET_KEY || parsed.TRIGGER_SECRET_KEY;
if (!secretKey) throw new Error("TRIGGER_SECRET_KEY is not set");

const names = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
  "AIRTABLE_TOKEN",
  "AIRTABLE_API_KEY",
  "AIRTABLE_BASE_ID",
  "AIRTABLE_POSTS_TABLE",
  "AIRTABLE_MEDIA_TABLE",
  "AIRTABLE_PROFILES_TABLE",
  "AIRTABLE_USAGE_EVENTS_TABLE",
  "LIBRARY_BUST_URL",
  "LIBRARY_BUST_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
];
const variables = {};
for (const name of names) {
  if (!parsed[name]) throw new Error(`Missing ${name} in .env`);
  variables[name] = parsed[name];
}

configure({ secretKey });
await envvars.upload("proj_kemmtnzvbsfmcchcoevx", "prod", {
  variables,
  override: true,
});
console.log(`uploaded ${names.length} R2 variables to Trigger.dev prod`);
