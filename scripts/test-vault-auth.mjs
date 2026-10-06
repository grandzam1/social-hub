#!/usr/bin/env node
/**
 * HTTP checks for vault bearer auth and the global secret fallback.
 *
 * Talks to a running API (default http://127.0.0.1:8787). Creates a disposable
 * global secret and a project token, then deletes both.
 *
 *   node scripts/test-vault-auth.mjs
 *   API_URL=http://127.0.0.1:8787 node scripts/test-vault-auth.mjs
 */
const API = (process.env.API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function request(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}

function errorOf(body) {
  if (body && typeof body === "object" && "error" in body) return String(body.error);
  return "";
}

async function main() {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const project = `vault-probe-${suffix}`;
  const name = `vault_probe_${suffix}`;
  const secret = `probe-${crypto.randomUUID()}`;
  let tokenId = "";

  try {
    const health = await request("/health");
    record("API reachable", health.status === 200 && health.body?.ok === true, `${API} → ${health.status}`);
    if (health.status !== 200) return;

    const missingAuth = await request(`/api/vault/env?name=${name}`);
    record(
      "missing bearer is rejected",
      missingAuth.status === 401 && errorOf(missingAuth.body) === "Unauthorized",
      `${missingAuth.status} ${errorOf(missingAuth.body) || "no error"}`,
    );

    const badBearer = await request(`/api/vault/env?name=${name}`, {
      headers: { Authorization: "Bearer not-a-vault-token" },
    });
    record(
      "invalid bearer is rejected",
      badBearer.status === 401 && errorOf(badBearer.body) === "Unauthorized",
      `${badBearer.status} ${errorOf(badBearer.body) || "no error"}`,
    );

    const badId = await request("/api/vault/tokens/not-a-token/reveal");
    record(
      "invalid token id",
      badId.status === 404 && errorOf(badId.body) === "Access token not found",
      `${badId.status} ${errorOf(badId.body) || "no error"}`,
    );

    const missingId = await request(
      "/api/vault/tokens/00000000-0000-0000-0000-000000000000/reveal",
    );
    record(
      "missing token id",
      missingId.status === 404 && errorOf(missingId.body) === "Access token not found",
      `${missingId.status} ${errorOf(missingId.body) || "no error"}`,
    );

    const createdSecret = await request(`/api/connections/global/${name}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "setting", value: secret }),
    });
    record(
      "global probe secret stored",
      createdSecret.status === 200 && createdSecret.body?.ok === true,
      `${createdSecret.status} ${errorOf(createdSecret.body)}`,
    );
    if (!createdSecret.body?.ok) return;

    const local = await request(`/api/connections/${project}/${name}/reveal`);
    record(
      "probe project has no local secret",
      local.status === 404 && errorOf(local.body) === "Connection not found",
      `${local.status} ${errorOf(local.body) || "no error"}`,
    );

    const issued = await request("/api/vault/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, label: "vault-auth-probe" }),
    });
    const token = issued.body?.token?.token;
    tokenId = issued.body?.token?.id ?? "";
    record(
      "project access token issued",
      issued.status === 200 && typeof token === "string" && token.startsWith("vault_"),
      `${issued.status} project=${issued.body?.token?.project ?? ""}`,
    );
    if (!token || !tokenId) return;

    const env = await request(`/api/vault/env?name=${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const value = env.body?.values?.[name];
    record(
      "bearer token authenticates /api/vault/env",
      env.status === 200 && env.body?.project === project,
      `${env.status} project=${env.body?.project ?? ""}`,
    );
    record(
      "project without a local secret falls back to global",
      env.status === 200 && value === secret,
      value === secret ? "matched global value" : `status=${env.status}`,
    );
  } catch (err) {
    record("request", false, err instanceof Error ? err.message : String(err));
  } finally {
    if (tokenId) {
      const removed = await request(`/api/vault/tokens/${tokenId}`, { method: "DELETE" }).catch(
        (err) => ({ status: 0, body: { error: err instanceof Error ? err.message : String(err) } }),
      );
      record(
        "probe token deleted",
        removed.status === 200 && removed.body?.ok === true,
        `${removed.status}`,
      );
    }
    const removedSecret = await request(`/api/connections/global/${name}`, {
      method: "DELETE",
    }).catch((err) => ({
      status: 0,
      body: { error: err instanceof Error ? err.message : String(err) },
    }));
    const cleaned =
      (removedSecret.status === 200 && removedSecret.body?.ok === true) ||
      removedSecret.status === 404;
    record("probe secret deleted", cleaned, `${removedSecret.status}`);
  }

  const failed = results.filter((item) => !item.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
}

await main();
