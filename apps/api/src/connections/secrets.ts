import {
  getConnection,
  isReservedConnectionName,
  setConnection,
  type ConnectionKind,
  type ConnectionsEnv,
} from "./index.js";

export const APP_PROJECT = "social-hub";

export type AppSecretSpec = {
  env: string;
  name: string;
  kind: ConnectionKind;
  /** Read when `env` is empty. Import uses the same order. */
  altEnv?: string;
};

export const SECRET_CATALOG: AppSecretSpec[] = [
  { env: "APIFY_TOKEN", name: "apify", kind: "secret" },
  { env: "SCRAPECREATORS_API_KEY", name: "scrapecreators", kind: "secret" },
  { env: "SUPABASE_URL", name: "supabase_url", kind: "secret" },
  { env: "SUPABASE_SECRET_KEY", name: "supabase_secret_key", kind: "secret" },
  { env: "SUPABASE_PUBLISHABLE_KEY", name: "supabase_publishable_key", kind: "secret" },
  { env: "AIRTABLE_TOKEN", name: "airtable_token", kind: "secret", altEnv: "AIRTABLE_API_KEY" },
  { env: "AIRTABLE_BASE_ID", name: "airtable_base_id", kind: "setting" },
  { env: "AIRTABLE_POSTS_TABLE", name: "airtable_posts_table", kind: "setting" },
  { env: "AIRTABLE_MEDIA_TABLE", name: "airtable_media_table", kind: "setting" },
  { env: "AIRTABLE_PROFILES_TABLE", name: "airtable_profiles_table", kind: "setting" },
  { env: "AIRTABLE_USAGE_EVENTS_TABLE", name: "airtable_usage_events_table", kind: "setting" },
  { env: "R2_ACCOUNT_ID", name: "r2_account_id", kind: "secret" },
  { env: "R2_ACCESS_KEY_ID", name: "r2_access_key_id", kind: "secret" },
  { env: "R2_SECRET_ACCESS_KEY", name: "r2_secret_access_key", kind: "secret" },
  { env: "R2_BUCKET", name: "r2_bucket", kind: "setting" },
  { env: "R2_PUBLIC_BASE_URL", name: "r2_public_base_url", kind: "setting" },
  { env: "TRIGGER_SECRET_KEY", name: "trigger_secret_key", kind: "secret" },
  { env: "LIBRARY_BUST_URL", name: "library_bust_url", kind: "setting" },
  { env: "LIBRARY_BUST_SECRET", name: "library_bust_secret", kind: "secret" },
  { env: "DB_PROVIDER", name: "db_provider", kind: "setting" },
];

const catalogByName = new Map(SECRET_CATALOG.map((spec) => [spec.name, spec]));

export function isBlockedSecretName(name: string): boolean {
  return isReservedConnectionName(name);
}

function envFallback(spec: AppSecretSpec): string {
  const primary = process.env[spec.env]?.trim() ?? "";
  if (primary) return primary;
  if (!spec.altEnv) return "";
  return process.env[spec.altEnv]?.trim() ?? "";
}

/**
 * Vault row wins. A missing row, including after delete, falls back to the environment.
 */
export async function getAppSecret(
  env: ConnectionsEnv,
  vaultName: string,
): Promise<string | null> {
  const stored = await getConnection(env, APP_PROJECT, vaultName);
  if (stored != null) {
    const value = stored.trim();
    return value || null;
  }
  const spec = catalogByName.get(vaultName);
  if (!spec) return null;
  return envFallback(spec) || null;
}

/** Copy non-empty env values into the vault. Skips existing rows. A delete can be restored. */
export async function importEnvSecrets(env: ConnectionsEnv): Promise<void> {
  if (!env.DB || !env.MASTER_KEY?.trim()) return;
  for (const spec of SECRET_CATALOG) {
    if (isBlockedSecretName(spec.name) || isBlockedSecretName(spec.env)) continue;
    const existing = await getConnection(env, APP_PROJECT, spec.name);
    if (existing != null) continue;
    const value = envFallback(spec);
    if (!value) continue;
    await setConnection(env, APP_PROJECT, spec.name, spec.kind, value);
  }
}
