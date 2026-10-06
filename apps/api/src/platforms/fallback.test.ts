import { beforeEach, describe, expect, it } from "vitest";
import {
  createFallbackProvider,
  resetScrapeFallbackState,
  setScrapeClock,
} from "./fallback.js";
import type { ScrapeProvider } from "./types.js";
import type { NormalizedScrape, Platform } from "../lib/types.js";

const POST_URL = "https://www.instagram.com/p/AbC123/";

function scrape(postId = "ok"): NormalizedScrape {
  return {
    platform: "instagram",
    postId,
    url: POST_URL,
    caption: "hello",
    authorHandle: "@ada",
    media: [],
  };
}

function httpError(status: number, extra = ""): Error {
  return new Error(`Provider call: ${status} ${extra}`.trim());
}

function fake(
  name: string,
  fetchPost: () => Promise<NormalizedScrape>,
): ScrapeProvider & { calls: number } {
  const provider = {
    name,
    calls: 0,
    async fetchPost() {
      provider.calls += 1;
      return fetchPost();
    },
    async fetchFeed() {
      return [];
    },
  };
  return provider;
}

describe("scrape provider fallback", () => {
  beforeEach(() => {
    resetScrapeFallbackState();
  });

  it("uses the next provider after HTTP 402 and reports who answered", async () => {
    const primary = fake("scrapecreators", async () => {
      throw httpError(402);
    });
    const secondary = fake("apify", async () => scrape("from-apify"));
    const scraper = createFallbackProvider([primary, secondary], {
      autoSwitch: true,
    });

    const result = await scraper.fetchPost(POST_URL);

    expect(result.postId).toBe("from-apify");
    expect(result.providerUsed).toBe("apify");
    expect(result.fallbackUsed).toBe(true);
    expect(primary.calls).toBe(1);
    expect(secondary.calls).toBe(1);
  });

  it("uses the next provider after HTTP 429 and skips it for one minute", async () => {
    let now = 5_000;
    setScrapeClock(() => now);
    let primaryCalls = 0;
    const primary = fake("scrapecreators", async () => {
      primaryCalls += 1;
      if (primaryCalls === 1) throw httpError(429);
      return scrape("primary-again");
    });
    const secondary = fake("apify", async () => scrape("from-apify"));
    const scraper = createFallbackProvider([primary, secondary], {
      autoSwitch: true,
    });

    const result = await scraper.fetchPost(POST_URL);
    expect(result.providerUsed).toBe("apify");
    expect(result.fallbackUsed).toBe(true);

    const during = await scraper.fetchPost(POST_URL);
    expect(during.providerUsed).toBe("apify");
    expect(primary.calls).toBe(1);

    now += 60_000 + 1;
    const after = await scraper.fetchPost(POST_URL);
    expect(after.providerUsed).toBe("scrapecreators");
    expect(after.fallbackUsed).toBe(false);
    expect(primary.calls).toBe(2);
  });

  it("does not fall back when the post is not found", async () => {
    const primary = fake("scrapecreators", async () => {
      throw new Error("post not found");
    });
    const secondary = fake("apify", async () => scrape());
    const scraper = createFallbackProvider([primary, secondary], {
      autoSwitch: true,
    });

    await expect(scraper.fetchPost(POST_URL)).rejects.toThrow("post not found");
    expect(primary.calls).toBe(1);
    expect(secondary.calls).toBe(0);
  });

  it("falls back when the provider route returns a non-JSON 404", async () => {
    const primary = fake("scrapecreators", async () => {
      throw new Error("ScrapeCreators /v1/tiktok/video: non-JSON 404 Not Found");
    });
    const secondary = fake("apify", async () => scrape("from-apify"));
    const scraper = createFallbackProvider([primary, secondary], {
      autoSwitch: true,
    });

    const result = await scraper.fetchPost(POST_URL);
    expect(result.providerUsed).toBe("apify");
    expect(result.fallbackUsed).toBe(true);
    expect(secondary.calls).toBe(1);
  });

  it("lists each provider and its reason when every provider fails", async () => {
    const primary = fake("scrapecreators", async () => {
      throw httpError(402, "token sk_live_SHOULD_NOT_LEAK");
    });
    const secondary = fake("apify", async () => {
      throw httpError(401);
    });
    const scraper = createFallbackProvider([primary, secondary], {
      autoSwitch: true,
    });

    let message = "";
    try {
      await scraper.fetchPost(POST_URL);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/scrapecreators: HTTP 402/);
    expect(message).toMatch(/apify: HTTP 401/);
    expect(message).not.toContain("SHOULD_NOT_LEAK");
  });

  it("does not fall back when auto-switch is off", async () => {
    const primary = fake("scrapecreators", async () => {
      throw httpError(402);
    });
    const secondary = fake("apify", async () => scrape());
    const scraper = createFallbackProvider([primary, secondary], {
      autoSwitch: false,
    });

    await expect(scraper.fetchPost(POST_URL)).rejects.toThrow(/402/);
    expect(primary.calls).toBe(1);
    expect(secondary.calls).toBe(0);
  });

  it("skips a provider during its cooldown on the next call", async () => {
    let now = 1_000_000;
    setScrapeClock(() => now);
    let primaryCalls = 0;
    const primary = fake("scrapecreators", async () => {
      primaryCalls += 1;
      if (primaryCalls === 1) throw httpError(402);
      return scrape("primary-recovered");
    });
    const secondary = fake("apify", async () => scrape("from-apify"));
    const scraper = createFallbackProvider([primary, secondary], {
      autoSwitch: true,
    });

    await scraper.fetchPost(POST_URL);
    const second = await scraper.fetchPost(POST_URL);

    expect(second.providerUsed).toBe("apify");
    expect(second.fallbackUsed).toBe(true);
    expect(primary.calls).toBe(1);
    expect(secondary.calls).toBe(2);

    now += 10 * 60 * 1000 + 1;
    const third = await scraper.fetchPost(POST_URL);
    expect(third.providerUsed).toBe("scrapecreators");
    expect(third.fallbackUsed).toBe(false);
    expect(primary.calls).toBe(2);
  });
});

describe("scrape provider credits", () => {
  beforeEach(() => {
    resetScrapeFallbackState();
  });

  it("returns the primary balance and keeps a secondary failure", async () => {
    const primary: ScrapeProvider = {
      name: "scrapecreators",
      async fetchPost() {
        return scrape();
      },
      async fetchFeed(_handle: string, _platform: Platform) {
        return [];
      },
      async getCredits() {
        return { remaining: 12 };
      },
    };
    const secondary: ScrapeProvider = {
      name: "apify",
      async fetchPost() {
        return scrape();
      },
      async fetchFeed(_handle: string, _platform: Platform) {
        return [];
      },
      async getCredits() {
        throw new Error("Apify users/me: 401 denied");
      },
    };
    const scraper = createFallbackProvider([primary, secondary], {
      autoSwitch: true,
    });

    const credits = await scraper.getCredits?.();
    expect(credits?.remaining).toBe(12);
    expect(credits?.providers).toEqual([
      { name: "scrapecreators", remaining: 12 },
      { name: "apify", remaining: null },
    ]);
  });
});
