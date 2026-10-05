import { describe, expect, it } from "vitest";
import { filterVaultValues, serviceForName } from "./groups.js";

describe("service groups", () => {
  it("groups env names and vault names by prefix", () => {
    expect(serviceForName("SUPABASE_URL").id).toBe("supabase");
    expect(serviceForName("supabase_secret_key").id).toBe("supabase");
    expect(serviceForName("APIFY_TOKEN").id).toBe("apify");
    expect(serviceForName("apify").id).toBe("apify");
    expect(serviceForName("AIRTABLE_API_KEY").id).toBe("airtable");
    expect(serviceForName("DB_PROVIDER").id).toBe("catalog");
    expect(serviceForName("PORT").id).toBe("other");
  });

  it("filters vault values by service or name", () => {
    const values = {
      apify: "a",
      airtable_token: "t",
      AIRTABLE_BASE_ID: "b",
    };
    expect(filterVaultValues(values, { service: "airtable" })).toEqual({
      airtable_token: "t",
      AIRTABLE_BASE_ID: "b",
    });
    expect(filterVaultValues(values, { name: "AIRTABLE_TOKEN" })).toEqual({
      airtable_token: "t",
    });
    expect(filterVaultValues(values, { name: "missing" })).toEqual({});
    expect(filterVaultValues(values, { service: "nope" })).toEqual({});
    expect(filterVaultValues(values, {})).toEqual(values);
  });
});
