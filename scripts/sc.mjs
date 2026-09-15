#!/usr/bin/env node
/**
 * Standalone ScrapeCreators helper — cache-first, never burn credits by accident.
 *
 *   node scripts/sc.mjs balance              # credits left (1 cheap call)
 *   node scripts/sc.mjs get /v1/twitter/tweet --url 'https://x.com/.../status/...'
 *   node scripts/sc.mjs fixture list
 *   node scripts/sc.mjs fixture use tesla-x-feed.json
 *   node scripts/sc.mjs offline              # set reminder: SC_MODE=offline
 *
 * Env:
 *   SC_MODE=cache|offline|live   (default: cache)
 *   SC_VENDOR_CACHE_HOURS=24      (0-credit vendor cache when live)
 *   SC_FIXTURE=name.json          (force named fixture in offline/cache)
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { loadEnv, root } from "./lib/load-env.mjs";

loadEnv();

const CACHE_DIR = join(root, ".cache", "scrapecreators");
const FIXTURES_DIR = join(root, "fixtures", "scrapecreators");

function mode() {
  const raw = (process.env.SC_MODE || "cache").toLowerCase();
  if (raw === "offline" || raw === "fixture" || raw === "fixtures") return "offline";
  if (raw === "live" || raw === "nocache") return "live";
  return "cache";
}

function keyFor(path, params) {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha256").update(`${path}?${sorted}`).digest("hex").slice(0, 24);
}

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) out.flags[name] = true;
      else {
        out.flags[name] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

async function apiGet(path, params) {
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) throw new Error("Missing SCRAPECREATORS_API_KEY in .env");
  const callParams = { ...params };
  const hours = process.env.SC_VENDOR_CACHE_HOURS?.trim();
  if (hours && !callParams.cache_max_age) callParams.cache_max_age = hours;
  const qs = new URLSearchParams(callParams).toString();
  const url = qs
    ? `https://api.scrapecreators.com${path}?${qs}`
    : `https://api.scrapecreators.com${path}`;
  const res = await fetch(url, { headers: { "x-api-key": key } });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`non-JSON ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

function readDisk(path, params) {
  const k = keyFor(path, params);
  const disk = join(CACHE_DIR, `${k}.json`);
  if (existsSync(disk)) {
    return { body: JSON.parse(readFileSync(disk, "utf8")), source: "cache", file: disk, k };
  }
  const named = process.env.SC_FIXTURE || "";
  if (named) {
    const p = named.includes("/") ? named : join(FIXTURES_DIR, named);
    if (existsSync(p)) {
      return { body: JSON.parse(readFileSync(p, "utf8")), source: "fixture", file: p, k };
    }
  }
  const byKey = join(FIXTURES_DIR, `${k}.json`);
  if (existsSync(byKey)) {
    return { body: JSON.parse(readFileSync(byKey, "utf8")), source: "fixture", file: byKey, k };
  }
  return null;
}

function writeDisk(path, params, body) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const k = keyFor(path, params);
  const disk = join(CACHE_DIR, `${k}.json`);
  const payload =
    typeof body === "object" && body && !Array.isArray(body)
      ? {
          ...body,
          __scCache: { at: new Date().toISOString(), path, params },
        }
      : { __scPayload: body, __scCache: { at: new Date().toISOString(), path, params } };
  writeFileSync(disk, JSON.stringify(payload, null, 2));
  return { disk, k };
}

async function smartGet(path, params) {
  const m = mode();
  if (m !== "live") {
    const hit = readDisk(path, params);
    if (hit) {
      console.error(`[sc] ${hit.source} → ${hit.file}`);
      return hit.body;
    }
  }
  if (m === "offline") {
    throw new Error(
      `offline: no cache/fixture for ${path}. Promote a prior response first.`,
    );
  }
  console.error(`[sc] LIVE ${path} (mode=${m})`);
  const body = await apiGet(path, params);
  const saved = writeDisk(path, params, body);
  console.error(`[sc] saved cache ${saved.k}`);
  return body;
}

function printHelp() {
  console.log(`sc.mjs — cache-first ScrapeCreators CLI

Commands:
  balance                         Credit balance
  get <path> [--url U] [--handle H] [--save alias]
  fixture list                    List fixtures/
  fixture save <alias> <path> ... Save last live/cache into fixtures/<alias>.json
  offline-hint                    Print env to stay offline

Examples:
  SC_MODE=offline node scripts/sc.mjs get /v1/twitter/tweet --url 'https://x.com/x/status/1'
  node scripts/sc.mjs get /v1/twitter/user-tweets --handle Tesla --save tesla-x-feed
  SC_MODE=live SC_VENDOR_CACHE_HOURS=168 node scripts/sc.mjs balance
`);
}

const { _, flags } = parseArgs(process.argv.slice(2));
const cmd = _[0];

if (!cmd || cmd === "help" || flags.help) {
  printHelp();
  process.exit(0);
}

if (cmd === "offline-hint" || cmd === "offline") {
  console.log(`# Add to ~/workspace/social-hub/.env while rate-limited:
SC_MODE=offline
# Optional force a named dump:
# SC_FIXTURE=last-x-raw.json
# When you must call live once:
# SC_MODE=cache SC_VENDOR_CACHE_HOURS=168
`);
  process.exit(0);
}

if (cmd === "fixture" && _[1] === "list") {
  if (!existsSync(FIXTURES_DIR)) {
    console.log("(no fixtures yet)");
    process.exit(0);
  }
  for (const f of readdirSync(FIXTURES_DIR).filter((x) => x.endsWith(".json"))) {
    const p = join(FIXTURES_DIR, f);
    const n = readFileSync(p).length;
    console.log(`${f}\t${n} bytes`);
  }
  process.exit(0);
}

if (cmd === "balance") {
  const body = await smartGet("/v1/account/credit-balance", {});
  console.log(JSON.stringify(body, null, 2));
  process.exit(0);
}

if (cmd === "get") {
  const path = _[1];
  if (!path?.startsWith("/")) {
    console.error("Usage: sc.mjs get /v1/twitter/tweet --url '…'");
    process.exit(1);
  }
  const params = {};
  if (flags.url) params.url = String(flags.url);
  if (flags.handle) params.handle = String(flags.handle).replace(/^@/, "");
  if (flags.sort_by) params.sort_by = String(flags.sort_by);
  if (flags.next_max_id) params.next_max_id = String(flags.next_max_id);
  if (flags.max_cursor) params.max_cursor = String(flags.max_cursor);

  const body = await smartGet(path, params);
  if (flags.save) {
    if (!existsSync(FIXTURES_DIR)) mkdirSync(FIXTURES_DIR, { recursive: true });
    const alias = String(flags.save).endsWith(".json")
      ? String(flags.save)
      : `${flags.save}.json`;
    const dest = join(FIXTURES_DIR, alias);
    const clean = { ...body };
    delete clean.__scCache;
    if (clean.__scPayload) {
      writeFileSync(dest, JSON.stringify(clean.__scPayload, null, 2));
    } else {
      writeFileSync(dest, JSON.stringify(clean, null, 2));
    }
    console.error(`[sc] fixture saved → ${dest}`);
  }
  console.log(JSON.stringify(body, null, 2));
  process.exit(0);
}

console.error(`Unknown command: ${cmd}`);
printHelp();
process.exit(1);
