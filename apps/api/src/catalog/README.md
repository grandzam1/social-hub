Reads and writes profiles, posts, and media through one catalog.
Exposes getCatalog(env) and the Catalog type. Providers are supabase (default), airtable, and memory (tests).
Needs the setting db_provider when D1 is present. Without D1, set DB_PROVIDER (default supabase). Airtable needs AIRTABLE_TOKEN or AIRTABLE_API_KEY, plus the base and table ids. Supabase needs SUPABASE_URL and SUPABASE_SECRET_KEY. If those are missing, getCatalog throws and names the missing variable. It does not fall back to Airtable. Switching the setting does not move data.
