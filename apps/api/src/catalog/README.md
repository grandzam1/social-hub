Reads and writes profiles, posts, and media through one catalog.
Exposes getCatalog(env) and the Catalog type. Providers are airtable (default), supabase, and memory (tests).
Needs the setting db_provider when D1 is present. Without D1, set DB_PROVIDER (default airtable). Airtable needs AIRTABLE_TOKEN or AIRTABLE_API_KEY, plus the base and table ids. Supabase needs SUPABASE_URL and SUPABASE_SECRET_KEY.
