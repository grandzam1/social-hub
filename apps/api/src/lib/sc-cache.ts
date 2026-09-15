import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Disk cache for ScrapeCreators responses.
 * Modes (SC_MODE):
 *   cache   — read disk first; on miss call API and save (default for local)
 *   offline — disk/fixtures only; never call ScrapeCreators
 *   live    — always call API (still writes cache unless SC_CACHE_WRITE=0)
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
/** social-hub root (apps/api/src/lib → ../../../../) */
export const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
export const CACHE_DIR = join(REPO_ROOT, ".cache", "scrapecreators");
export const FIXTURES_DIR = join(REPO_ROOT, "fixtures", "scrapecreators");

export type ScMode = "cache" | "offline" | "live";

export function scMode(): ScMode {
  const raw = (process.env.SC_MODE || "cache").toLowerCase().trim();
  if (raw === "offline" || raw === "fixture" || raw === "fixtures") return "offline";
  if (raw === "live" || raw === "nocache") return "live";
  return "cache";
}

export function cacheKey(path: string, params: Record<string, string>): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  const raw = `${path}?${sorted}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

function cachePath(key: string): string {
  return join(CACHE_DIR, `${key}.json`);
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export type CacheHit = {
  body: unknown;
  source: "cache" | "fixture";
  key: string;
  path: string;
};

/** Try disk cache, then fixtures/<key>.json or fixtures by alias. */
export function readCached(
  path: string,
  params: Record<string, string>,
): CacheHit | null {
  const key = cacheKey(path, params);
  const disk = cachePath(key);
  if (existsSync(disk)) {
    return {
      body: JSON.parse(readFileSync(disk, "utf8")),
      source: "cache",
      key,
      path: disk,
    };
  }

  const fixtureByKey = join(FIXTURES_DIR, `${key}.json`);
  if (existsSync(fixtureByKey)) {
    return {
      body: JSON.parse(readFileSync(fixtureByKey, "utf8")),
      source: "fixture",
      key,
      path: fixtureByKey,
    };
  }

  // Named fixture override: SC_FIXTURE=tesla-x-feed.json
  const named = process.env.SC_FIXTURE?.trim();
  if (named) {
    const p = named.includes("/") || named.includes("\\")
      ? named
      : join(FIXTURES_DIR, named);
    if (existsSync(p)) {
      return {
        body: JSON.parse(readFileSync(p, "utf8")),
        source: "fixture",
        key,
        path: p,
      };
    }
  }

  return null;
}

export function writeCached(
  path: string,
  params: Record<string, string>,
  body: unknown,
): string {
  if (process.env.SC_CACHE_WRITE === "0") return "";
  ensureDir(CACHE_DIR);
  const key = cacheKey(path, params);
  const disk = cachePath(key);
  const meta = {
    _cachedAt: new Date().toISOString(),
    _path: path,
    _params: params,
    data: body,
  };
  // Store raw API body at top level for drop-in use; meta alongside
  writeFileSync(
    disk,
    JSON.stringify(
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? { ...(body as object), __scCache: { at: meta._cachedAt, path, params } }
        : { __scPayload: body, __scCache: { at: meta._cachedAt, path, params } },
      null,
      2,
    ),
  );
  return disk;
}

/** Strip cache metadata before handing to normalizers. */
export function stripCacheMeta(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const o = { ...(body as Record<string, unknown>) };
  if ("__scPayload" in o) return o.__scPayload;
  delete o.__scCache;
  return o;
}

/** Promote a cache file into fixtures/ for permanent reuse (0 API cost forever). */
export function promoteToFixture(
  path: string,
  params: Record<string, string>,
  alias: string,
): string {
  const hit = readCached(path, params);
  if (!hit) throw new Error(`Nothing cached for ${path}`);
  ensureDir(FIXTURES_DIR);
  const name = alias.endsWith(".json") ? alias : `${alias}.json`;
  const dest = join(FIXTURES_DIR, name);
  writeFileSync(dest, JSON.stringify(stripCacheMeta(hit.body), null, 2));
  return dest;
}
