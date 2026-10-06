import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { SERVICE_GROUPS } from "./groups.js";
import { getStoredConnection, type ConnectionsEnv } from "./index.js";
import { listProjectLinks } from "./links.js";

export type HealthResult = {
  ok: boolean;
  service: string;
  status: "valid" | "invalid";
  detail: string;
};

const DEFAULT_R2_BUCKET = "scrape-kit-media";

function invalid(service: string, detail: string): HealthResult {
  return { ok: false, service, status: "invalid", detail };
}

function valid(service: string): HealthResult {
  return { ok: true, service, status: "valid", detail: "Valid" };
}

async function firstStored(
  env: ConnectionsEnv,
  project: string,
  names: string[],
): Promise<string | null> {
  const layers = [project];
  if (project !== "global") {
    layers.push(...(await listProjectLinks(env, project)), "global");
  }
  const seen = new Set<string>();
  for (const layer of layers) {
    if (seen.has(layer)) continue;
    seen.add(layer);
    for (const name of names) {
      const value = (await getStoredConnection(env, layer, name))?.trim();
      if (value) return value;
    }
  }
  return null;
}

async function probe(url: string, init?: RequestInit): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(url, init);
    await res.body?.cancel();
    if (res.ok) return { ok: true, detail: "Valid" };
    return { ok: false, detail: `HTTP ${res.status}` };
  } catch {
    return { ok: false, detail: "network error" };
  }
}

function fromProbe(service: string, result: { ok: boolean; detail: string }): HealthResult {
  return result.ok ? valid(service) : invalid(service, result.detail);
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isProbeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

async function checkApify(env: ConnectionsEnv, project: string): Promise<HealthResult> {
  const token = await firstStored(env, project, ["apify", "APIFY_TOKEN"]);
  if (!token) return invalid("apify", "Missing APIFY_TOKEN");
  return fromProbe(
    "apify",
    await probe("https://api.apify.com/v2/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
}

async function checkScrapeCreators(env: ConnectionsEnv, project: string): Promise<HealthResult> {
  const key = await firstStored(env, project, ["scrapecreators", "SCRAPECREATORS_API_KEY"]);
  if (!key) return invalid("scrapecreators", "Missing SCRAPECREATORS_API_KEY");
  return fromProbe(
    "scrapecreators",
    await probe("https://api.scrapecreators.com/v1/account/credit-balance", {
      headers: { "x-api-key": key },
    }),
  );
}

async function checkSupabase(env: ConnectionsEnv, project: string): Promise<HealthResult> {
  const url = await firstStored(env, project, ["supabase_url", "SUPABASE_URL"]);
  const key = await firstStored(env, project, ["supabase_secret_key", "SUPABASE_SECRET_KEY"]);
  if (!url || !key) return invalid("supabase", "Missing SUPABASE_URL or SUPABASE_SECRET_KEY");
  if (!isHttpsUrl(url) || !new URL(url).hostname.endsWith(".supabase.co")) {
    return invalid("supabase", "SUPABASE_URL is not a Supabase host");
  }
  return fromProbe(
    "supabase",
    await probe(`${url.replace(/\/+$/, "")}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    }),
  );
}

async function checkAirtable(env: ConnectionsEnv, project: string): Promise<HealthResult> {
  const token = await firstStored(env, project, [
    "airtable_token",
    "AIRTABLE_TOKEN",
    "AIRTABLE_API_KEY",
  ]);
  if (!token) return invalid("airtable", "Missing AIRTABLE_TOKEN");
  return fromProbe(
    "airtable",
    await probe("https://api.airtable.com/v0/meta/whoami", {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
}

async function checkR2(env: ConnectionsEnv, project: string): Promise<HealthResult> {
  const accountId = await firstStored(env, project, ["r2_account_id", "R2_ACCOUNT_ID"]);
  const accessKeyId = await firstStored(env, project, ["r2_access_key_id", "R2_ACCESS_KEY_ID"]);
  const secretAccessKey = await firstStored(env, project, [
    "r2_secret_access_key",
    "R2_SECRET_ACCESS_KEY",
  ]);
  const bucket =
    (await firstStored(env, project, ["r2_bucket", "R2_BUCKET"])) || DEFAULT_R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    return invalid("r2", "Missing R2 account or keys");
  }
  if (!/^[a-f0-9]{32}$/i.test(accountId)) return invalid("r2", "R2 account id is invalid");
  try {
    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
    await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
    return valid("r2");
  } catch {
    return invalid("r2", "R2 request failed");
  }
}

async function checkTrigger(env: ConnectionsEnv, project: string): Promise<HealthResult> {
  const key = await firstStored(env, project, ["trigger_secret_key", "TRIGGER_SECRET_KEY"]);
  if (!key) return invalid("trigger", "Missing TRIGGER_SECRET_KEY");
  return fromProbe(
    "trigger",
    await probe("https://api.trigger.dev/api/v1/runs?limit=1", {
      headers: { Authorization: `Bearer ${key}` },
    }),
  );
}

async function checkLibrary(env: ConnectionsEnv, project: string): Promise<HealthResult> {
  const url = await firstStored(env, project, ["library_bust_url", "LIBRARY_BUST_URL"]);
  const secret = await firstStored(env, project, ["library_bust_secret", "LIBRARY_BUST_SECRET"]);
  if (!url || !secret) return invalid("library", "Missing LIBRARY_BUST_URL or LIBRARY_BUST_SECRET");
  if (!isProbeUrl(url)) return invalid("library", "LIBRARY_BUST_URL is not an allowed URL");
  return fromProbe(
    "library",
    await probe(url, { method: "GET", headers: { Authorization: `Bearer ${secret}` } }),
  );
}

async function checkComposio(env: ConnectionsEnv, project: string): Promise<HealthResult> {
  const key = await firstStored(env, project, ["COMPOSIO_API_KEY", "composio_api_key"]);
  if (!key) return invalid("composio", "Missing COMPOSIO_API_KEY");
  return fromProbe(
    "composio",
    await probe("https://backend.composio.dev/api/v3.1/auth/session/info", {
      headers: { "x-api-key": key },
    }),
  );
}

async function checkCatalog(env: ConnectionsEnv, project: string): Promise<HealthResult> {
  const provider = (
    (await firstStored(env, project, ["db_provider", "DB_PROVIDER"])) ?? ""
  ).toLowerCase();
  if (provider === "memory") return valid("catalog");
  if (provider === "supabase") {
    const result = await checkSupabase(env, project);
    return result.ok ? valid("catalog") : invalid("catalog", result.detail);
  }
  if (provider === "airtable") {
    const result = await checkAirtable(env, project);
    return result.ok ? valid("catalog") : invalid("catalog", result.detail);
  }
  return invalid("catalog", provider ? "Unsupported DB_PROVIDER" : "Missing DB_PROVIDER");
}

const CHECKS: Record<
  string,
  (env: ConnectionsEnv, project: string) => Promise<HealthResult>
> = {
  apify: checkApify,
  scrapecreators: checkScrapeCreators,
  supabase: checkSupabase,
  airtable: checkAirtable,
  r2: checkR2,
  trigger: checkTrigger,
  library: checkLibrary,
  composio: checkComposio,
  catalog: checkCatalog,
};

export async function checkServiceHealth(
  env: ConnectionsEnv,
  project: string,
  service: string,
): Promise<HealthResult> {
  const id = service.trim().toLowerCase();
  if (!env.DB) throw new Error("D1 binding DB is not configured");
  if (!env.MASTER_KEY?.trim()) throw new Error("MASTER_KEY is not set");
  const known = SERVICE_GROUPS.some((group) => group.id === id);
  const check = CHECKS[id];
  if (!known || !check) return invalid(id || service, "Unknown service");
  return check(env, project);
}
