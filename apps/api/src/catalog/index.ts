import { getConnection, type ConnectionsEnv } from "../connections/index.js";
import { airtableCatalog } from "./providers/airtable.js";
import { memoryCatalog } from "./providers/memory.js";
import type { Catalog } from "./types.js";

export type { AirtableRecord, Catalog, CatalogPage } from "./types.js";

export async function getCatalog(env: ConnectionsEnv): Promise<Catalog> {
  const value =
    (await getConnection(env, "social-hub", "db_provider"))
      ?.trim()
      .toLowerCase() || "airtable";
  if (value === "airtable") return airtableCatalog;
  if (value === "memory") return memoryCatalog;
  throw new Error(
    `Unknown db_provider "${value}". Expected "airtable" or "memory".`,
  );
}
