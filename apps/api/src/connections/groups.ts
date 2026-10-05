import { SECRET_CATALOG } from "./secrets.js";

export type ServiceGroup = {
  id: string;
  label: string;
  prefixes: string[];
};

/** Prefixes match env names (`SUPABASE_URL`) and vault names (`supabase_url`). */
export const SERVICE_GROUPS: ServiceGroup[] = [
  { id: "apify", label: "Apify", prefixes: ["apify"] },
  { id: "scrapecreators", label: "ScrapeCreators", prefixes: ["scrapecreators"] },
  { id: "supabase", label: "Supabase", prefixes: ["supabase_"] },
  { id: "airtable", label: "Airtable", prefixes: ["airtable_"] },
  { id: "r2", label: "R2", prefixes: ["r2_"] },
  { id: "trigger", label: "Trigger", prefixes: ["trigger_"] },
  { id: "library", label: "Library", prefixes: ["library_"] },
  { id: "composio", label: "Composio", prefixes: ["composio_"] },
  { id: "catalog", label: "Catalog", prefixes: ["db_provider"] },
];

export const OTHER_GROUP: ServiceGroup = { id: "other", label: "Other", prefixes: [] };

export function serviceForName(name: string): ServiceGroup {
  const key = name.trim().toLowerCase();
  const ranked = SERVICE_GROUPS.flatMap((group) =>
    group.prefixes.map((prefix) => ({ group, prefix })),
  ).sort((a, b) => b.prefix.length - a.prefix.length);
  for (const { group, prefix } of ranked) {
    if (key.startsWith(prefix)) return group;
  }
  return OTHER_GROUP;
}

function catalogAliases(name: string): Set<string> {
  const aliases = new Set<string>([name.trim().toLowerCase()]);
  for (const spec of SECRET_CATALOG) {
    const keys = [spec.env, spec.name, spec.altEnv].filter((key): key is string => Boolean(key));
    if (!keys.some((key) => key.toLowerCase() === name.trim().toLowerCase())) continue;
    for (const key of keys) aliases.add(key.toLowerCase());
  }
  return aliases;
}

export function filterVaultValues(
  values: Record<string, string>,
  query: { service?: string; name?: string },
): Record<string, string> {
  const service = query.service?.trim().toLowerCase() ?? "";
  const requested = (query.name ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!service && requested.length === 0) return values;

  const aliases = new Set<string>();
  for (const name of requested) {
    for (const alias of catalogAliases(name)) aliases.add(alias);
  }

  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const inService = !service || serviceForName(key).id === service;
    const named = requested.length === 0 || aliases.has(key.toLowerCase());
    if (inService && named) filtered[key] = value;
  }
  return filtered;
}
