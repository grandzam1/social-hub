import { Hono } from "hono";
import {
  getConnection,
  setConnection,
  type ConnectionsEnv,
} from "../../connections/index.js";
import { getAppSecret } from "../../connections/secrets.js";
import {
  probeScrapeProvider,
  providerLastCredits,
  providerLastResult,
} from "../../platforms/index.js";
import { createApifyProvider } from "../../platforms/providers/apify.js";
import { createScrapeCreatorsProvider } from "../../platforms/providers/scrapecreators.js";

const PROJECT = "social-hub";
const PROVIDER_NAMES = ["scrapecreators", "apify"] as const;

type ProviderName = (typeof PROVIDER_NAMES)[number];

export const settingsRoutes = new Hono<{ Bindings: ConnectionsEnv }>();

function isProvider(value: string): value is ProviderName {
  return value === "scrapecreators" || value === "apify";
}

async function readChoice(
  env: ConnectionsEnv,
): Promise<{
  primary: ProviderName;
  fallback: ProviderName | "none";
  autoSwitch: boolean;
  dbProvider: "supabase" | "airtable";
}> {
  const orderRaw = (await getConnection(env, PROJECT, "scrape_order"))?.trim().toLowerCase();
  const legacy = (await getConnection(env, PROJECT, "scrape_provider"))?.trim().toLowerCase();
  const autoRaw = (await getConnection(env, PROJECT, "scrape_auto_switch"))
    ?.trim()
    .toLowerCase();
  const storedDb = (await getAppSecret(env, "db_provider"))?.trim().toLowerCase();

  let names: string[] = [];
  if (orderRaw) names = orderRaw.split(",").map((part) => part.trim()).filter(Boolean);
  else if (legacy) names = [legacy];
  else names = ["apify", "scrapecreators"];

  const first = names[0] ?? "";
  const second = names[1] ?? "";
  const primary: ProviderName = isProvider(first) ? first : "apify";
  const fallback: ProviderName | "none" =
    isProvider(second) && second !== primary ? second : "none";
  const dbValue = storedDb || "supabase";
  return {
    primary,
    fallback,
    autoSwitch: autoRaw !== "off",
    dbProvider: dbValue === "airtable" ? "airtable" : "supabase",
  };
}

async function keyConfigured(env: ConnectionsEnv, name: ProviderName): Promise<boolean> {
  const vaultName = name === "scrapecreators" ? "scrapecreators" : "apify";
  return Boolean((await getAppSecret(env, vaultName))?.trim());
}

async function snapshot(env: ConnectionsEnv) {
  const choice = await readChoice(env);
  const providers = await Promise.all(
    PROVIDER_NAMES.map(async (name) => {
      const remaining = providerLastCredits(name);
      return {
        name,
        keyConfigured: await keyConfigured(env, name),
        lastResult: providerLastResult(name),
        credits: remaining === undefined ? null : { remaining },
      };
    }),
  );
  return { ...choice, providers };
}

settingsRoutes.get("/providers", async (c) => {
  try {
    return c.json({ ok: true, ...(await snapshot(c.env)) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});

settingsRoutes.put("/providers", async (c) => {
  try {
    const body = (await c.req.json()) as {
      primary?: string;
      fallback?: string;
      autoSwitch?: boolean;
      dbProvider?: string;
    };
    if (!body.primary || !isProvider(body.primary)) {
      return c.json(
        { ok: false, error: 'primary must be "scrapecreators" or "apify"' },
        400,
      );
    }
    if (body.fallback !== "none" && (!body.fallback || !isProvider(body.fallback))) {
      return c.json(
        { ok: false, error: 'fallback must be "scrapecreators", "apify", or "none"' },
        400,
      );
    }
    if (typeof body.autoSwitch !== "boolean") {
      return c.json({ ok: false, error: "autoSwitch must be true or false" }, 400);
    }
    if (body.dbProvider !== "supabase" && body.dbProvider !== "airtable") {
      return c.json(
        { ok: false, error: 'dbProvider must be "supabase" or "airtable"' },
        400,
      );
    }
    const fallback = body.fallback === body.primary ? "none" : body.fallback;
    const order =
      !fallback || fallback === "none" ? body.primary : `${body.primary},${fallback}`;
    await setConnection(c.env, PROJECT, "scrape_order", "setting", order);
    await setConnection(
      c.env,
      PROJECT,
      "scrape_auto_switch",
      "setting",
      body.autoSwitch ? "on" : "off",
    );
    await setConnection(c.env, PROJECT, "db_provider", "setting", body.dbProvider);
    return c.json({ ok: true, ...(await snapshot(c.env)) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});

settingsRoutes.post("/providers/:name/test", async (c) => {
  const name = c.req.param("name");
  if (!isProvider(name)) {
    return c.json({ ok: false, error: "Unknown provider" }, 404);
  }
  try {
    const provider =
      name === "scrapecreators"
        ? createScrapeCreatorsProvider()
        : createApifyProvider(c.env);
    const result = await probeScrapeProvider(provider);
    return c.json({
      ok: true,
      name,
      status: result.status,
      at: result.at,
      message: result.message,
      credits: { remaining: result.remaining },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});
