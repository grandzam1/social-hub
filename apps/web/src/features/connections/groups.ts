export type ServiceGroup = {
  id: string;
  label: string;
  prefixes: string[];
};

/** Keep prefixes aligned with apps/api/src/connections/groups.ts. */
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

export function serviceOrder(id: string): number {
  const index = SERVICE_GROUPS.findIndex((group) => group.id === id);
  return index === -1 ? SERVICE_GROUPS.length : index;
}
