import { getConnection, type ConnectionsEnv } from "../connections/index.js";
import { airtableCatalog } from "./providers/airtable.js";
import { memoryCatalog } from "./providers/memory.js";
import { supabaseCatalog } from "./providers/supabase.js";
import type { Catalog } from "./types.js";

export type { AirtableRecord, Catalog, CatalogPage } from "./types.js";

export async function getCatalog(env: ConnectionsEnv): Promise<Catalog> {
  const stored = (await getConnection(env, "social-hub", "db_provider"))
    ?.trim()
    .toLowerCase();
  const fromEnv = process.env.DB_PROVIDER?.trim().toLowerCase();
  const value = stored || fromEnv || "airtable";
  if (value === "airtable") return airtableCatalog;
  if (value === "memory") return memoryCatalog;
  if (value === "supabase") return supabaseCatalog;
  throw new Error(
    `Unknown db_provider "${value}". Expected "airtable", "supabase", or "memory".`,
  );
}
