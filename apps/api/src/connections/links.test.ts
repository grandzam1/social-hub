import { afterEach, describe, expect, it, vi } from "vitest";
import { clearConnectionsCache, setConnection, type ConnectionsDb, type ConnectionsEnv } from "./index.js";
import { checkServiceHealth } from "./health.js";
import { listProjectLinks, setProjectLinks } from "./links.js";
import { createProjectToken, readVaultEnv } from "./tokens.js";

type ConnectionRow = {
  id: string;
  project: string;
  name: string;
  kind: string;
  value_encrypted: string;
  updated_at: string;
};

type TokenRow = {
  id: string;
  project: string;
  label: string;
  token_encrypted: string;
  token_hash: string;
  created_at: string;
  last_used_at: string | null;
};

type LinkRow = {
  id: string;
  project: string;
  source: string;
  position: number;
};

class MemoryDb implements ConnectionsDb {
  connections: ConnectionRow[] = [];
  tokens: TokenRow[] = [];
  links: LinkRow[] = [];

  prepare(sql: string) {
    let values: unknown[] = [];
    const statement = {
      bind(...next: unknown[]) {
        values = next;
        return statement;
      },
      first: async <T>() => this.first(sql, values) as T | null,
      all: async <T>() => ({ results: this.all(sql, values) as T[] }),
      run: async () => {
        this.run(sql, values);
      },
    };
    return statement;
  }

  async batch(statements: Array<{ run: () => Promise<unknown> }>) {
    for (const statement of statements) await statement.run();
  }

  private first(sql: string, values: unknown[]) {
    if (sql.includes("FROM project_tokens WHERE token_hash")) {
      const [token_hash] = values as string[];
      const row = this.tokens.find((item) => item.token_hash === token_hash);
      return row ? { id: row.id, project: row.project } : null;
    }
    if (sql.includes("FROM connections WHERE project = ? AND name = ?")) {
      const [project, name] = values as string[];
      return this.connections.find((row) => row.project === project && row.name === name) ?? null;
    }
    return null;
  }

  private all(sql: string, values: unknown[]) {
    if (sql.includes("FROM project_links")) {
      const [project] = values as string[];
      return this.links
        .filter((row) => row.project === project)
        .sort((a, b) => a.position - b.position)
        .map((row) => ({ source: row.source }));
    }
    if (sql.includes("FROM connections WHERE project = ?")) {
      const [project] = values as string[];
      return this.connections
        .filter((row) => row.project === project)
        .map((row) => ({
          project: row.project,
          name: row.name,
          value_encrypted: row.value_encrypted,
        }));
    }
    const one = this.first(sql, values);
    return one ? [one] : [];
  }

  private run(sql: string, values: unknown[]) {
    if (sql.startsWith("UPDATE connections")) {
      const [kind, value_encrypted, updated_at, id] = values as string[];
      const row = this.connections.find((item) => item.id === id);
      if (!row) return;
      row.kind = kind;
      row.value_encrypted = value_encrypted;
      row.updated_at = updated_at;
      return;
    }
    if (sql.startsWith("INSERT INTO connections ")) {
      const [id, project, name, kind, value_encrypted, updated_at] = values as string[];
      this.connections.push({ id, project, name, kind, value_encrypted, updated_at });
      return;
    }
    if (sql.startsWith("INSERT INTO connections_history")) return;
    if (sql.startsWith("INSERT INTO project_tokens")) {
      const [id, project, label, token_encrypted, token_hash, created_at] = values as string[];
      this.tokens.push({
        id,
        project,
        label,
        token_encrypted,
        token_hash,
        created_at,
        last_used_at: null,
      });
      return;
    }
    if (sql.startsWith("UPDATE project_tokens SET last_used_at")) return;
    if (sql.startsWith("DELETE FROM project_links")) {
      const [project] = values as string[];
      this.links = this.links.filter((row) => row.project !== project);
      return;
    }
    if (sql.startsWith("INSERT INTO project_links")) {
      const [id, project, source, position] = values as [string, string, string, number];
      this.links.push({ id, project, source, position: Number(position) });
    }
  }
}

function masterKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function testEnv(): { env: ConnectionsEnv; db: MemoryDb } {
  const db = new MemoryDb();
  return { db, env: { DB: db, MASTER_KEY: masterKey() } };
}

describe("project links", () => {
  afterEach(() => {
    clearConnectionsCache();
    vi.unstubAllGlobals();
  });

  it("resolves own rows, then linked projects, then global", async () => {
    const { env } = testEnv();
    await setConnection(env, "global", "apify", "secret", "from-global");
    await setConnection(env, "global", "scrapecreators", "secret", "shared-scrape");
    await setConnection(env, "library", "apify", "secret", "from-library");
    await setConnection(env, "library", "airtable_token", "secret", "from-library-airtable");
    await setConnection(env, "social-hub", "apify", "secret", "from-social-hub");
    await setProjectLinks(env, "social-hub", ["library"]);

    const token = await createProjectToken(env, "social-hub", "app");
    const result = await readVaultEnv(env, token.token);

    expect(result?.project).toBe("social-hub");
    expect(result?.values.apify).toBe("from-social-hub");
    expect(result?.values.airtable_token).toBe("from-library-airtable");
    expect(result?.values.scrapecreators).toBe("shared-scrape");
  });

  it("lets the earlier linked project override a later one", async () => {
    const { env } = testEnv();
    await setConnection(env, "alpha", "apify", "secret", "from-alpha");
    await setConnection(env, "beta", "apify", "secret", "from-beta");
    await setProjectLinks(env, "social-hub", ["alpha", "beta"]);

    const token = await createProjectToken(env, "social-hub", "app");
    const result = await readVaultEnv(env, token.token);

    expect(result?.values.apify).toBe("from-alpha");
  });

  it("does not walk links of a linked project", async () => {
    const { env } = testEnv();
    await setConnection(env, "root", "apify", "secret", "from-root");
    await setConnection(env, "middle", "scrapecreators", "secret", "from-middle");
    await setProjectLinks(env, "middle", ["root"]);
    await setProjectLinks(env, "social-hub", ["middle"]);

    const token = await createProjectToken(env, "social-hub", "app");
    const result = await readVaultEnv(env, token.token);

    expect(result?.values.scrapecreators).toBe("from-middle");
    expect(result?.values.apify).toBeUndefined();
  });

  it("keeps a parent token from seeing the child project", async () => {
    const { env } = testEnv();
    await setConnection(env, "library", "apify", "secret", "from-library");
    await setConnection(env, "social-hub", "airtable_token", "secret", "from-child");
    await setProjectLinks(env, "social-hub", ["library"]);

    const parent = await createProjectToken(env, "library", "parent");
    const result = await readVaultEnv(env, parent.token);

    expect(result?.values.apify).toBe("from-library");
    expect(result?.values.airtable_token).toBeUndefined();
  });

  it("does not copy or change the source project when the child writes", async () => {
    const { env, db } = testEnv();
    await setConnection(env, "library", "apify", "secret", "from-library");
    await setProjectLinks(env, "social-hub", ["library"]);
    await setConnection(env, "social-hub", "apify", "secret", "from-child");

    const library = db.connections.filter((row) => row.project === "library" && row.name === "apify");
    const child = db.connections.filter((row) => row.project === "social-hub" && row.name === "apify");
    expect(library).toHaveLength(1);
    expect(child).toHaveLength(1);
    expect(library[0]?.id).not.toBe(child[0]?.id);
    await expect(listProjectLinks(env, "library")).resolves.toEqual([]);
  });

  it("rejects inheriting from itself, from global, or as global", async () => {
    const { env } = testEnv();
    await expect(setProjectLinks(env, "social-hub", ["social-hub"])).rejects.toThrow(/itself/);
    await expect(setProjectLinks(env, "social-hub", ["global"])).rejects.toThrow(/global/i);
    await expect(setProjectLinks(env, "global", ["library"])).rejects.toThrow(/global/i);
    await expect(setProjectLinks(env, "social-hub", ["library", "library"])).rejects.toThrow(/duplicate/i);
    await expect(listProjectLinks(env, "social-hub")).resolves.toEqual([]);
  });

  it("replaces the link list", async () => {
    const { env } = testEnv();
    await setProjectLinks(env, "social-hub", ["library", "alpha"]);
    await setProjectLinks(env, "social-hub", ["beta"]);
    await expect(listProjectLinks(env, "social-hub")).resolves.toEqual(["beta"]);
    await setProjectLinks(env, "social-hub", []);
    await expect(listProjectLinks(env, "social-hub")).resolves.toEqual([]);
  });

  it("tests the linked key when the project has none of its own", async () => {
    const { env } = testEnv();
    await setConnection(env, "global", "apify", "secret", "from-global");
    await setConnection(env, "library", "apify", "secret", "from-library");
    await setProjectLinks(env, "social-hub", ["library"]);
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkServiceHealth(env, "social-hub", "apify");

    expect(result).toEqual({ ok: true, service: "apify", status: "valid", detail: "Valid" });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer from-library" },
    });
  });

  it("tests the project's own key before a linked key", async () => {
    const { env } = testEnv();
    await setConnection(env, "library", "apify", "secret", "from-library");
    await setConnection(env, "social-hub", "APIFY_TOKEN", "secret", "from-own");
    await setProjectLinks(env, "social-hub", ["library"]);
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await checkServiceHealth(env, "social-hub", "apify");

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer from-own" },
    });
  });
});
