import { getConnection, type ConnectionsEnv } from "../connections/index.js";
import { createFallbackProvider } from "./fallback.js";
import { createApifyProvider } from "./providers/apify.js";
import { createScrapeCreatorsProvider } from "./providers/scrapecreators.js";
import type { ScrapeProvider } from "./types.js";

export type { ScrapeFeedPage, ScrapeProvider } from "./types.js";
export { FEED_ITEM } from "./types.js";
export {
  probeScrapeProvider,
  providerLastCredits,
  providerLastResult,
} from "./fallback.js";

const PROVIDERS = ["scrapecreators", "apify"] as const;

function parseOrder(value: string): string[] {
  const names = [
    ...new Set(
      value
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (!names.length) {
    throw new Error('scrape_order is empty. Expected "scrapecreators" and/or "apify".');
  }
  for (const name of names) {
    if (!PROVIDERS.includes(name as (typeof PROVIDERS)[number])) {
      throw new Error(
        `Unknown scrape provider "${name}". Expected "scrapecreators" or "apify".`,
      );
    }
  }
  return names;
}

function providerFor(env: ConnectionsEnv, name: string): ScrapeProvider {
  if (name === "scrapecreators") return createScrapeCreatorsProvider();
  return createApifyProvider(env);
}

export async function getScraper(env: ConnectionsEnv): Promise<ScrapeProvider> {
  const orderRaw = (await getConnection(env, "social-hub", "scrape_order"))?.trim();
  const legacy = (await getConnection(env, "social-hub", "scrape_provider"))
    ?.trim()
    .toLowerCase();
  const autoRaw = (await getConnection(env, "social-hub", "scrape_auto_switch"))
    ?.trim()
    .toLowerCase();

  let names: string[];
  if (orderRaw) {
    names = parseOrder(orderRaw);
  } else if (legacy) {
    if (legacy !== "scrapecreators" && legacy !== "apify") {
      throw new Error(
        `Unknown scrape_provider "${legacy}". Expected "scrapecreators" or "apify".`,
      );
    }
    names = [legacy];
  } else {
    names = ["scrapecreators", "apify"];
  }

  let autoSwitch = true;
  if (autoRaw === "off") autoSwitch = false;
  else if (autoRaw && autoRaw !== "on") {
    throw new Error(
      `Unknown scrape_auto_switch "${autoRaw}". Expected "on" or "off".`,
    );
  }

  return createFallbackProvider(
    names.map((name) => providerFor(env, name)),
    { autoSwitch },
  );
}
