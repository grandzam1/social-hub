import { Hono } from "hono";
import { decryptValue } from "../../connections/crypto.js";
import {
  deleteConnection,
  listConnections,
  listProjectValues,
  setConnection,
  setConnectionsBulk,
  type ConnectionKind,
  type ConnectionsEnv,
} from "../../connections/index.js";
import { checkServiceHealth } from "../../connections/health.js";
import { listProjectLinks, setProjectLinks } from "../../connections/links.js";
import { importEnvSecrets, isBlockedSecretName } from "../../connections/secrets.js";

const PROJECT_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const connectionsRoutes = new Hono<{ Bindings: ConnectionsEnv }>();

function fail(message: string, status: 400 | 404 | 503 = 400) {
  return { ok: false as const, error: message, status };
}

function statusFor(message: string): 400 | 503 | 500 {
  if (message.includes("not configured") || message.includes("not set")) return 503;
  if (message.includes("reserved name")) return 400;
  return 500;
}

function readIdentity(project: string, name: string) {
  const projectName = decodeURIComponent(project).trim();
  const connectionName = decodeURIComponent(name).trim();
  if (!PROJECT_PATTERN.test(projectName)) {
    return fail("project must be 1-64 letters, numbers, dots, dashes, or underscores");
  }
  if (!connectionName) return fail("empty name");
  if (!VARIABLE_NAME.test(connectionName)) return fail("illegal characters");
  if (isBlockedSecretName(connectionName)) return fail("reserved name");
  return { project: projectName, name: connectionName };
}

connectionsRoutes.get("/history", async (c) => {
  try {
    if (!c.env.DB) throw new Error("D1 binding DB is not configured");
    const data = await c.env.DB.prepare(
      "SELECT project, name, action, at FROM connections_history ORDER BY at DESC",
    ).all<{ project: string; name: string; action: "create" | "update" | "delete" | "refresh"; at: string }>();
    return c.json({ ok: true, history: data.results ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not configured") || message.includes("not set") ? 503 : 500;
    return c.json({ ok: false, error: message }, status);
  }
});

connectionsRoutes.get("/", async (c) => {
  try {
    await importEnvSecrets(c.env);
    const connections = await listConnections(c.env);
    return c.json({ ok: true, connections });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not configured") || message.includes("not set") ? 503 : 500;
    return c.json({ ok: false, error: message }, status);
  }
});

connectionsRoutes.post("/:project/health/:service", async (c) => {
  const project = decodeURIComponent(c.req.param("project")).trim();
  const service = decodeURIComponent(c.req.param("service")).trim();
  if (!PROJECT_PATTERN.test(project)) {
    return c.json(
      { ok: false, error: "project must be 1-64 letters, numbers, dots, dashes, or underscores" },
      400,
    );
  }
  try {
    const result = await checkServiceHealth(c.env, project, service);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, statusFor(message));
  }
});

connectionsRoutes.get("/:project/export", async (c) => {
  const project = decodeURIComponent(c.req.param("project")).trim();
  if (!PROJECT_PATTERN.test(project)) {
    return c.json({ ok: false, error: "project must be 1-64 letters, numbers, dots, dashes, or underscores" }, 400);
  }
  try {
    const values = await listProjectValues(c.env, project);
    return c.json({ ok: true, project, values });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not configured") || message.includes("not set") ? 503 : 500;
    return c.json({ ok: false, error: message }, status);
  }
});

connectionsRoutes.put("/:project/bulk", async (c) => {
  const project = decodeURIComponent(c.req.param("project")).trim();
  if (!PROJECT_PATTERN.test(project)) {
    return c.json({ ok: false, error: "project must be 1-64 letters, numbers, dots, dashes, or underscores" }, 400);
  }
  let body: { items?: unknown };
  try {
    body = (await c.req.json()) as { items?: unknown };
  } catch {
    return c.json({ ok: false, error: "JSON body required" }, 400);
  }
  if (!Array.isArray(body.items)) {
    return c.json({ ok: false, error: "items required" }, 400);
  }
  try {
    const result = await setConnectionsBulk(c.env, project, body.items);
    return c.json({ ok: true, project, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not configured") || message.includes("not set") ? 503 : 500;
    return c.json({ ok: false, error: message }, status);
  }
});

connectionsRoutes.get("/:project/links", async (c) => {
  const project = decodeURIComponent(c.req.param("project")).trim();
  if (!PROJECT_PATTERN.test(project)) {
    return c.json(
      { ok: false, error: "project must be 1-64 letters, numbers, dots, dashes, or underscores" },
      400,
    );
  }
  try {
    const sources = await listProjectLinks(c.env, project);
    return c.json({ ok: true, project, sources });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not configured") || message.includes("not set") ? 503 : 500;
    return c.json({ ok: false, error: message }, status);
  }
});

connectionsRoutes.put("/:project/links", async (c) => {
  const project = decodeURIComponent(c.req.param("project")).trim();
  if (!PROJECT_PATTERN.test(project)) {
    return c.json(
      { ok: false, error: "project must be 1-64 letters, numbers, dots, dashes, or underscores" },
      400,
    );
  }
  let body: { sources?: unknown };
  try {
    body = (await c.req.json()) as { sources?: unknown };
  } catch {
    return c.json({ ok: false, error: "JSON body required" }, 400);
  }
  if (!Array.isArray(body.sources) || body.sources.some((source) => typeof source !== "string")) {
    return c.json({ ok: false, error: "sources must be a list" }, 400);
  }
  try {
    const sources = await setProjectLinks(c.env, project, body.sources);
    return c.json({ ok: true, project, sources });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not configured") || message.includes("not set") ? 503 : 400;
    return c.json({ ok: false, error: message }, status);
  }
});

connectionsRoutes.get("/:project/:name/reveal", async (c) => {
  const identity = readIdentity(c.req.param("project"), c.req.param("name"));
  if ("error" in identity) return c.json(identity, identity.status);
  try {
    if (!c.env.DB) throw new Error("D1 binding DB is not configured");
    if (!c.env.MASTER_KEY?.trim()) throw new Error("MASTER_KEY is not set");
    const row = await c.env.DB.prepare(
      "SELECT value_encrypted FROM connections WHERE project = ? AND name = ?",
    )
      .bind(identity.project, identity.name)
      .first<{ value_encrypted: string }>();
    if (!row) return c.json({ ok: false, error: "Connection not found" }, 404);
    const value = await decryptValue(c.env.MASTER_KEY, row.value_encrypted);
    return c.json({
      ok: true,
      project: identity.project,
      name: identity.name,
      value,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});

connectionsRoutes.put("/:project/:name", async (c) => {
  const identity = readIdentity(c.req.param("project"), c.req.param("name"));
  if ("error" in identity) return c.json(identity, identity.status);
  let body: { kind?: string; value?: string };
  try {
    body = (await c.req.json()) as { kind?: string; value?: string };
  } catch {
    return c.json({ ok: false, error: "JSON body required" }, 400);
  }
  const kind = body.kind;
  if (kind !== "secret" && kind !== "setting") {
    return c.json({ ok: false, error: "kind must be secret or setting" }, 400);
  }
  if (typeof body.value !== "string" || !body.value) {
    return c.json({ ok: false, error: "value required" }, 400);
  }
  try {
    const result = await setConnection(
      c.env,
      identity.project,
      identity.name,
      kind as ConnectionKind,
      body.value,
    );
    return c.json({ ok: true, ...result, project: identity.project, name: identity.name });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, statusFor(message));
  }
});

connectionsRoutes.delete("/:project/:name", async (c) => {
  const identity = readIdentity(c.req.param("project"), c.req.param("name"));
  if ("error" in identity) return c.json(identity, identity.status);
  try {
    const deleted = await deleteConnection(c.env, identity.project, identity.name);
    if (!deleted) return c.json({ ok: false, error: "Connection not found" }, 404);
    return c.json({ ok: true, project: identity.project, name: identity.name });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not configured") || message.includes("not set") ? 503 : 500;
    return c.json({ ok: false, error: message }, status);
  }
});
