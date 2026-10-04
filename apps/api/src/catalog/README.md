Reads and writes profiles, posts, and media through one catalog.
Exposes getCatalog(env) and the Catalog type. Providers are airtable (default) and memory (tests).
Needs the setting db_provider. Airtable needs AIRTABLE_TOKEN or AIRTABLE_API_KEY, plus the base and table ids.
