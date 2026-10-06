import type { ConnectionsEnv } from "../connections/index.js";
import { getAppSecret } from "../connections/secrets.js";
import { airtableCatalog } from "./providers/airtable.js";
import { memoryCatalog } from "./providers/memory.js";
import { assertSupabaseConfigured, supabaseCatalog } from "./providers/supabase.js";
import type { Catalog } from "./types.js";

export type { AirtableRecord, Catalog, CatalogPage } from "./types.js";

/** Trigger.dev has no D1 setting. An unset DB_PROVIDER uses Supabase. */
export function ensureDefaultDbProvider(): void {
  if (!process.env.DB_PROVIDER?.trim()) {
    process.env.DB_PROVIDER = "supabase";
  }
}

export async function getCatalog(env: ConnectionsEnv): Promise<Catalog> {
  const stored = (await getAppSecret(env, "db_provider"))?.trim().toLowerCase();
  const value = stored || "supabase";
  if (value === "airtable") return airtableCatalog;
  if (value === "memory") return memoryCatalog;
  if (value === "supabase") {
    await assertSupabaseConfigured(env);
    return supabaseCatalog;
  }
  throw new Error(
    `Unknown db_provider "${value}". Expected "airtable", "supabase", or "memory".`,
  );
}
