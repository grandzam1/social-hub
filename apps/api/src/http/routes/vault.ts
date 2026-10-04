import { Hono } from "hono";
import type { ConnectionsEnv } from "../../connections/index.js";
import {
  createProjectToken,
  deleteProjectToken,
  listProjectTokens,
  readVaultEnv,
  refreshProjectToken,
  revealProjectToken,
} from "../../connections/tokens.js";

const PROJECT_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
const ID_PATTERN = /^[0-9a-f-]{36}$/i;

export const vaultRoutes = new Hono<{ Bindings: ConnectionsEnv }>();

function failure(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const status = message.includes("not configured") || message.includes("not set") ? 503 : 500;
  return { message, status } as const;
}

vaultRoutes.get("/env", async (c) => {
  const header = c.req.header("Authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/.exec(header);
  if (!match) return c.json({ error: "Unauthorized" }, 401);
  try {
    const result = await readVaultEnv(c.env, match[1]);
    if (!result) return c.json({ error: "Unauthorized" }, 401);
    return c.json(result);
  } catch (err) {
    const failed = failure(err);
    return c.json({ error: failed.message }, failed.status);
  }
});

vaultRoutes.get("/tokens", async (c) => {
  try {
    const tokens = await listProjectTokens(c.env);
    return c.json({ ok: true, tokens });
  } catch (err) {
    const failed = failure(err);
    return c.json({ ok: false, error: failed.message }, failed.status);
  }
});

vaultRoutes.post("/tokens", async (c) => {
  let body: { project?: string; label?: string };
  try {
    body = (await c.req.json()) as { project?: string; label?: string };
  } catch {
    return c.json({ ok: false, error: "JSON body required" }, 400);
  }
  const project = String(body.project ?? "").trim();
  const label = String(body.label ?? "").trim();
  if (!PROJECT_PATTERN.test(project)) {
    return c.json({ ok: false, error: "project must be 1-64 letters, numbers, dots, dashes, or underscores" }, 400);
  }
  if (label.length > 64) return c.json({ ok: false, error: "label is too long" }, 400);
  try {
    const token = await createProjectToken(c.env, project, label);
    return c.json({ ok: true, token });
  } catch (err) {
    const failed = failure(err);
    return c.json({ ok: false, error: failed.message }, failed.status);
  }
});

vaultRoutes.get("/tokens/:id/reveal", async (c) => {
  const id = c.req.param("id");
  if (!ID_PATTERN.test(id)) return c.json({ ok: false, error: "Token not found" }, 404);
  try {
    const value = await revealProjectToken(c.env, id);
    if (value == null) return c.json({ ok: false, error: "Token not found" }, 404);
    return c.json({ ok: true, value });
  } catch (err) {
    const failed = failure(err);
    return c.json({ ok: false, error: failed.message }, failed.status);
  }
});

vaultRoutes.post("/tokens/:id/refresh", async (c) => {
  const id = c.req.param("id");
  if (!ID_PATTERN.test(id)) return c.json({ ok: false, error: "Token not found" }, 404);
  try {
    const token = await refreshProjectToken(c.env, id);
    if (!token) return c.json({ ok: false, error: "Token not found" }, 404);
    return c.json({ ok: true, token });
  } catch (err) {
    const failed = failure(err);
    return c.json({ ok: false, error: failed.message }, failed.status);
  }
});

vaultRoutes.delete("/tokens/:id", async (c) => {
  const id = c.req.param("id");
  if (!ID_PATTERN.test(id)) return c.json({ ok: false, error: "Token not found" }, 404);
  try {
    const deleted = await deleteProjectToken(c.env, id);
    if (!deleted) return c.json({ ok: false, error: "Token not found" }, 404);
    return c.json({ ok: true });
  } catch (err) {
    const failed = failure(err);
    return c.json({ ok: false, error: failed.message }, failed.status);
  }
});
