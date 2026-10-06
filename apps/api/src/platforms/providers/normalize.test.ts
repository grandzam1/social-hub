import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  clearConnectionsCache,
  setConnection,
  type ConnectionsDb,
} from "../../connections/index.js";
import { getScraper } from "../index.js";
import {
  normalizeApifyInstagram,
  normalizeApifyTikTok,
  normalizeApifyX,
} from "./apify.js";
import { normalizeX } from "./scrapecreators.js";

const xFixture = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../../fixtures/scrapecreators/last-x-raw.json",
    ),
    "utf8",
  ),
) as Record<string, unknown>;

type Row = {
  id: string;
  project: string;
  name: string;
  kind: "secret" | "setting";
  value_encrypted: string;
  updated_at: string;
};

function memoryDb(): ConnectionsDb {
  const rows: Row[] = [];
  function statement(sql: string, values: unknown[] = []) {
    return {
      bind(...next: unknown[]) {
        return statement(sql, next);
      },
      async first<T>() {
        if (sql.includes("WHERE project = ? AND name = ?")) {
          const found = rows.find(
            (row) => row.project === values[0] && row.name === values[1],
          );
          return (found ?? null) as T | null;
        }
        return null;
      },
      async all() {
        return { results: rows };
      },
      async run() {
        if (sql.startsWith("INSERT INTO connections (")) {
          rows.push({
            id: String(values[0]),
            project: String(values[1]),
            name: String(values[2]),
            kind: values[3] as Row["kind"],
            value_encrypted: String(values[4]),
            updated_at: String(values[5]),
          });
        } else if (sql.startsWith("UPDATE connections")) {
          const row = rows.find((item) => item.id === values[3]);
          if (row) {
            row.kind = values[0] as Row["kind"];
            row.value_encrypted = String(values[1]);
            row.updated_at = String(values[2]);
          }
        }
      },
    };
  }
  return {
    prepare(sql: string) {
      return statement(sql);
    },
    async batch(statements) {
      for (const statement of statements) await statement.run();
    },
  } as ConnectionsDb;
}

describe("scrapecreators normalize", () => {
  it("maps the saved X fixture into NormalizedScrape", () => {
    const scrape = normalizeX(xFixture, "https://x.com/elonmusk/status/2088037519312994480");
    expect(scrape.platform).toBe("x");
    expect(scrape.postId).toBe("2088037519312994480");
    expect(scrape.authorHandle).toBe("@elonmusk");
    expect(scrape.caption).toContain("Tesla self-driving is amazing");
    expect(scrape.likes).toBe(27342);
    expect(scrape.comments).toBe(2786);
    expect(scrape.shares).toBe(3012);
    expect(scrape.views).toBe(7029945);
    expect(scrape.media.length).toBeGreaterThan(0);
    expect(scrape.media[0]?.type).toBe("video");
    expect(scrape.creditsRemaining).toBe(93);
  });
});

const apifyInstagramFixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "fixtures/apify-instagram.json"),
    "utf8",
  ),
) as Record<string, unknown>[];

describe("apify normalize", () => {
  it("maps the saved Instagram actor fixture", () => {
    const raw = apifyInstagramFixture[0]!;
    const instagram = normalizeApifyInstagram(
      raw,
      "https://www.instagram.com/p/DeAJFvrHOTl/",
    );
    expect(instagram.platform).toBe("instagram");
    expect(instagram.postId).toBe("DeAJFvrHOTl");
    expect(instagram.url).toBe("https://www.instagram.com/p/DeAJFvrHOTl/");
    expect(instagram.authorHandle).toBe("@spacex");
    expect(instagram.authorName).toBe("SpaceX");
    expect(instagram.caption).toBe(
      "Starship's first orbital flight delivered 26 Starlink V3 satellites to space",
    );
    expect(instagram.postType).toBe("carousel");
    expect(instagram.likes).toBe(29114);
    expect(instagram.comments).toBe(317);
    expect(instagram.postedAt).toBe("2026-10-02T18:35:57.000Z");
    expect(instagram.platformUserId).toBe("20311520");
    expect(instagram.authorAvatar).toBeUndefined();
    expect(instagram.authorVerified).toBeUndefined();
    expect(instagram.media).toHaveLength(4);
    expect(instagram.media.map((item) => item.type)).toEqual([
      "image",
      "image",
      "image",
      "image",
    ]);
    expect(instagram.media.every((item) => item.fileUrl.startsWith("https://"))).toBe(
      true,
    );
    expect(instagram.media[0]?.width).toBe(3840);
    expect(instagram.media[0]?.height).toBe(2160);
  });

  it("maps a hand-written item for TikTok and X", () => {
    const tiktok = normalizeApifyTikTok(
      {
        id: "7123",
        text: "a video",
        webVideoUrl: "https://www.tiktok.com/@ada/video/7123",
        authorMeta: { name: "ada", nickName: "Ada", fans: 9 },
        videoMeta: { downloadAddr: "https://cdn.example/tt.mp4", coverUrl: "https://cdn.example/tt.jpg", duration: 3 },
        diggCount: 4,
        playCount: 5,
      },
      "https://www.tiktok.com/@ada/video/7123",
    );
    expect(tiktok.platform).toBe("tiktok");
    expect(tiktok.postId).toBe("7123");
    expect(tiktok.authorHandle).toBe("@ada");
    expect(tiktok.authorName).toBe("Ada");
    expect(tiktok.caption).toBe("a video");
    expect(tiktok.media[0]?.fileUrl).toBe("https://cdn.example/tt.mp4");
    expect(tiktok.likes).toBe(4);
    expect(tiktok.views).toBe(5);

    const tweet = normalizeApifyX(
      {
        id: "99",
        text: "hello",
        url: "https://x.com/ada/status/99",
        author: { userName: "ada", name: "Ada", followers: 3 },
        likeCount: 8,
        media: [{ type: "photo", media_url_https: "https://cdn.example/x.jpg" }],
      },
      "https://x.com/ada/status/99",
    );
    expect(tweet.platform).toBe("x");
    expect(tweet.postId).toBe("99");
    expect(tweet.authorHandle).toBe("@ada");
    expect(tweet.caption).toBe("hello");
    expect(tweet.likes).toBe(8);
    expect(tweet.media[0]?.type).toBe("image");
    expect(tweet.media[0]?.fileUrl).toBe("https://cdn.example/x.jpg");
  });
});

describe("getScraper", () => {
  it("rejects an unknown scrape_provider", async () => {
    clearConnectionsCache();
    const env = {
      DB: memoryDb(),
      MASTER_KEY: randomBytes(32).toString("base64"),
    };
    await setConnection(env, "social-hub", "scrape_provider", "setting", "nope");
    await expect(getScraper(env)).rejects.toThrow(
      'Unknown scrape_provider "nope". Expected "scrapecreators" or "apify".',
    );
  });

  it("names the missing Apify token", async () => {
    clearConnectionsCache();
    const env = {
      DB: memoryDb(),
      MASTER_KEY: randomBytes(32).toString("base64"),
    };
    await setConnection(env, "social-hub", "scrape_provider", "setting", "apify");
    const previous = process.env.APIFY_TOKEN;
    delete process.env.APIFY_TOKEN;
    const scraper = await getScraper(env);
    try {
      await expect(
        scraper.fetchPost("https://www.instagram.com/p/AbC123/"),
      ).rejects.toThrow('Missing connection "apify" for project "social-hub".');
    } finally {
      if (previous == null) delete process.env.APIFY_TOKEN;
      else process.env.APIFY_TOKEN = previous;
    }
  });
});
