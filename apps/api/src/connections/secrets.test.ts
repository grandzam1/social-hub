import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearConnectionsCache,
  deleteConnection,
  getConnection,
  setConnection,
  type ConnectionsDb,
  type ConnectionsEnv,
} from "./index.js";
import { checkServiceHealth } from "./health.js";
import { getAppSecret, importEnvSecrets } from "./secrets.js";

type ConnectionRow = {
  id: string;
  project: string;
  name: string;
  kind: string;
  value_encrypted: string;
  updated_at: string;
};

type HistoryRow = {
  id: string;
  project: string;
  name: string;
  action: string;
  at: string;
  seq: number;
};

class MemoryDb implements ConnectionsDb {
  connections: ConnectionRow[] = [];
  history: HistoryRow[] = [];
  private seq = 0;

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
    if (sql.includes("FROM connections_history")) {
      const [project, name] = values as string[];
      const rows = this.history
        .filter((row) => row.project === project && row.name === name)
        .sort((a, b) => b.at.localeCompare(a.at) || b.seq - a.seq);
      return rows[0] ? { action: rows[0].action } : null;
    }
    if (sql.includes("FROM connections")) {
      const [project, name] = values as string[];
      return (
        this.connections.find((row) => row.project === project && row.name === name) ?? null
      );
    }
    return null;
  }

  private all(sql: string, values: unknown[]) {
    return this.first(sql, values) ? [this.first(sql, values)] : [];
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
    if (sql.startsWith("INSERT INTO connections_history")) {
      const [id, project, name, action, at] = values as string[];
      this.seq += 1;
      this.history.push({ id, project, name, action, at, seq: this.seq });
      return;
    }
    if (sql.startsWith("DELETE FROM connections")) {
      const [id] = values as string[];
      this.connections = this.connections.filter((row) => row.id !== id);
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

describe("app secrets", () => {
  const previous = {
    apify: process.env.APIFY_TOKEN,
    scrape: process.env.SCRAPECREATORS_API_KEY,
    master: process.env.MASTER_KEY,
  };

  afterEach(() => {
    clearConnectionsCache();
    if (previous.apify == null) delete process.env.APIFY_TOKEN;
    else process.env.APIFY_TOKEN = previous.apify;
    if (previous.scrape == null) delete process.env.SCRAPECREATORS_API_KEY;
    else process.env.SCRAPECREATORS_API_KEY = previous.scrape;
    if (previous.master == null) delete process.env.MASTER_KEY;
    else process.env.MASTER_KEY = previous.master;
  });

  it("uses the vault value when the env var differs", async () => {
    const { env } = testEnv();
    process.env.APIFY_TOKEN = "from-env";
    await setConnection(env, "social-hub", "apify", "secret", "from-vault");
    await expect(getAppSecret(env, "apify")).resolves.toBe("from-vault");
  });

  it("restores a deleted secret from the environment", async () => {
    const { env } = testEnv();
    process.env.APIFY_TOKEN = "from-env";
    await setConnection(env, "social-hub", "apify", "secret", "from-vault");
    await deleteConnection(env, "social-hub", "apify");
    await expect(getAppSecret(env, "apify")).resolves.toBe("from-env");
    await importEnvSecrets(env);
    await expect(getConnection(env, "social-hub", "apify")).resolves.toBe("from-env");
  });

  it("does not import over an existing row", async () => {
    const { env } = testEnv();
    process.env.APIFY_TOKEN = "from-env";
    await setConnection(env, "social-hub", "apify", "secret", "kept");
    await importEnvSecrets(env);
    await expect(getConnection(env, "social-hub", "apify")).resolves.toBe("kept");
  });

  it("imports a non-empty env value once", async () => {
    const { env } = testEnv();
    process.env.SCRAPECREATORS_API_KEY = "first-key";
    await importEnvSecrets(env);
    await expect(getConnection(env, "social-hub", "scrapecreators")).resolves.toBe("first-key");
    process.env.SCRAPECREATORS_API_KEY = "second-key";
    await importEnvSecrets(env);
    await expect(getConnection(env, "social-hub", "scrapecreators")).resolves.toBe("first-key");
  });

  it("does not import MASTER_KEY", async () => {
    const { env, db } = testEnv();
    process.env.MASTER_KEY = env.MASTER_KEY;
    process.env.APIFY_TOKEN = "from-env";
    await importEnvSecrets(env);
    expect(db.connections.map((row) => row.name)).not.toContain("MASTER_KEY");
    expect(db.connections.map((row) => row.name)).not.toContain("master_key");
    expect(db.connections.map((row) => row.name)).toContain("apify");
  });

  it("rejects storing MASTER_KEY", async () => {
    const { env, db } = testEnv();
    await expect(setConnection(env, "social-hub", "MASTER_KEY", "secret", "nope")).rejects.toThrow(
      /reserved name/,
    );
    await expect(setConnection(env, "social-hub", "Master_Key", "secret", "nope")).rejects.toThrow(
      /reserved name/,
    );
    expect(db.connections).toHaveLength(0);
  });
});

describe("service health", () => {
  afterEach(() => {
    clearConnectionsCache();
    vi.unstubAllGlobals();
  });

  it("reports a valid Apify token without returning the secret", async () => {
    const { env } = testEnv();
    await setConnection(env, "social-hub", "apify", "secret", "secret-token");
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await checkServiceHealth(env, "social-hub", "apify");
    expect(result).toEqual({ ok: true, service: "apify", status: "valid", detail: "Valid" });
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports a missing key as invalid", async () => {
    const { env } = testEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await checkServiceHealth(env, "social-hub", "airtable");
    expect(result.status).toBe("invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
