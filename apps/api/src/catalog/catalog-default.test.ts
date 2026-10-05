import { afterEach, describe, expect, it } from "vitest";
import { ensureDefaultDbProvider, getCatalog } from "./index.js";
import { supabaseCatalog } from "./providers/supabase.js";
import type { ConnectionsEnv } from "../connections/index.js";

const env: ConnectionsEnv = {};

describe("catalog default provider", () => {
  const previous = {
    db: process.env.DB_PROVIDER,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SECRET_KEY,
  };

  afterEach(() => {
    if (previous.db == null) delete process.env.DB_PROVIDER;
    else process.env.DB_PROVIDER = previous.db;
    if (previous.url == null) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previous.url;
    if (previous.key == null) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previous.key;
  });

  it("uses supabase when db_provider is unset", async () => {
    delete process.env.DB_PROVIDER;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "test-only";
    await expect(getCatalog(env)).resolves.toBe(supabaseCatalog);
  });

  it("names the missing Supabase variable and mentions Airtable", async () => {
    delete process.env.DB_PROVIDER;
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = "test-only";
    await expect(getCatalog(env)).rejects.toThrow(/SUPABASE_URL/);
    await expect(getCatalog(env)).rejects.toThrow(/Airtable/);
  });

  it("sets DB_PROVIDER to supabase in the Trigger default when unset", () => {
    delete process.env.DB_PROVIDER;
    ensureDefaultDbProvider();
    expect(process.env.DB_PROVIDER).toBe("supabase");
  });
});
