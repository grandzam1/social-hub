import type { NormalizedScrape, Platform } from "../lib/types.js";

export type ScrapeFeedPage = NormalizedScrape[] & {
  nextCursor?: string;
  creditsCharged?: number;
  creditsRemaining?: number;
};

/** Original feed card, kept so Batch still sees the same fields. */
export const FEED_ITEM = Symbol.for("social-hub.feedItem");

export interface ScrapeProvider {
  name: string;
  fetchPost(url: string): Promise<NormalizedScrape>;
  fetchFeed(
    handle: string,
    platform: Platform,
    cursor?: string,
  ): Promise<NormalizedScrape[]>;
  getCredits?(): Promise<{
    remaining: number | null;
    given?: number | null;
    used?: number | null;
    providers?: Array<{ name: string; remaining: number | null }>;
  }>;
}
