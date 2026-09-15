#!/usr/bin/env node
/**
 * Standalone Cloudflare / Wrangler readiness check for WSL.
 * Does not deploy and does not call ScrapeCreators.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const api = join(root, "apps/api");

function ok(msg) {
  console.log(`✅ ${msg}`);
}
function bad(msg) {
  console.log(`❌ ${msg}`);
}
function info(msg) {
  console.log(`•  ${msg}`);
}

const checks = [];

function run(cmd, args, cwd = api) {
  return spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(api, "node_modules/.bin")}:${process.env.PATH}`,
    },
  });
}

console.log("=== Cloudflare / Wrangler check (WSL) ===\n");

// Node
const node = run("node", ["-v"], root);
if (node.status === 0) {
  ok(`Node ${node.stdout.trim()}`);
  checks.push(true);
} else {
  bad("Node missing — source nvm first");
  checks.push(false);
}

// Local wrangler (must be Linux binary, not Windows npm global)
const wranglerBin = join(api, "node_modules/.bin/wrangler");
if (existsSync(wranglerBin)) {
  const ver = run("wrangler", ["--version"]);
  ok(`Local wrangler ${ver.stdout.trim() || ver.stderr.trim()}`);
  checks.push(true);
} else {
  bad("wrangler not installed in apps/api — run: npm i -D wrangler@latest");
  checks.push(false);
}

// workerd linux
const workerdLinux = join(api, "node_modules/@cloudflare/workerd-linux-64");
if (existsSync(workerdLinux)) {
  ok("workerd-linux-64 present (WSL-compatible)");
  checks.push(true);
} else {
  bad("workerd-linux-64 missing — reinstall wrangler inside WSL");
  checks.push(false);
}

// Config
const wranglerConfig = join(api, "wrangler.jsonc");
if (existsSync(wranglerConfig)) {
  ok("wrangler.jsonc found");
  checks.push(true);
} else {
  bad("wrangler.jsonc missing");
  checks.push(false);
}

const worker = join(api, "src/worker.ts");
if (existsSync(worker)) {
  ok("src/worker.ts entry found");
  checks.push(true);
} else {
  bad("src/worker.ts missing");
  checks.push(false);
}

// Auth
const who = run("wrangler", ["whoami"]);
const whoText = `${who.stdout}\n${who.stderr}`;
if (/You are not authenticated/i.test(whoText)) {
  bad("Not logged in — run: npm run cf:login  (in apps/api)");
  checks.push(false);
} else if (who.status === 0) {
  ok("Wrangler authenticated");
  info(whoText.trim().split("\n").slice(0, 6).join(" | "));
  checks.push(true);
} else {
  bad(`wrangler whoami failed: ${whoText.trim().slice(0, 200)}`);
  checks.push(false);
}

// Env secrets needed for real deploy (names only)
const envPath = join(root, ".env");
const needed = [
  "SCRAPECREATORS_API_KEY",
  "AIRTABLE_TOKEN",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_PUBLIC_BASE_URL",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
];
if (existsSync(envPath)) {
  const env = readFileSync(envPath, "utf8");
  const present = needed.filter((k) => new RegExp(`^${k}=.`, "m").test(env));
  const missing = needed.filter((k) => !present.includes(k));
  ok(`.env has ${present.length}/${needed.length} deploy secrets (local only)`);
  if (missing.length) info(`still empty locally: ${missing.join(", ")}`);
} else {
  bad(".env missing at repo root");
}

console.log("\n=== PATH tip ===");
info("Always use apps/api local wrangler — Windows global wrangler breaks WSL workerd.");
info("cd ~/workspace/social-hub/apps/api && npm run cf:login");

const failed = checks.filter((c) => !c).length;
console.log(`\nResult: ${checks.length - failed}/${checks.length} hard checks passed`);
process.exit(failed ? 1 : 0);
