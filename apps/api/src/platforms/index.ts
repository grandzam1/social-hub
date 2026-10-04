import { getConnection, type ConnectionsEnv } from "../connections/index.js";
import { createApifyProvider } from "./providers/apify.js";
import { createScrapeCreatorsProvider } from "./providers/scrapecreators.js";
import type { ScrapeProvider } from "./types.js";

export type { ScrapeFeedPage, ScrapeProvider } from "./types.js";
export { FEED_ITEM } from "./types.js";

export async function getScraper(env: ConnectionsEnv): Promise<ScrapeProvider> {
  const value =
    (await getConnection(env, "social-hub", "scrape_provider"))
      ?.trim()
      .toLowerCase() || "scrapecreators";
  if (value === "scrapecreators") return createScrapeCreatorsProvider();
  if (value === "apify") return createApifyProvider(env);
  throw new Error(
    `Unknown scrape_provider "${value}". Expected "scrapecreators" or "apify".`,
  );
}
