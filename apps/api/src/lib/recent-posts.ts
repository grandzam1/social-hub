import { connectionsEnv } from "../connections/runtime.js";
import { FEED_ITEM, getScraper, type ScrapeFeedPage } from "../platforms/index.js";
import type { NormalizedScrape, Platform } from "./types.js";

export type FeedPost = {
  id: string;
  platform: Platform;
  url: string;
  handle: string;
  name?: string;
  caption: string;
  postedAt?: string;
  thumbnail?: string;
  /** Extra preview URLs for carousels (first N slides). */
  previewUrls?: string[];
  mediaType: "image" | "video" | "carousel" | "gif" | "text";
  mediaCount: number;
  width?: number;
  height?: number;
  likes?: number;
  comments?: number;
  views?: number;
  repostKind?: "quote" | "retweet";
  quotedHandle?: string;
};

export type RecentPostsResult = {
  ok: true;
  platform: Platform;
  handle: string;
  note?: string;
  creditsCharged?: number;
  creditsRemaining?: number;
  posts: FeedPost[];
  nextCursor?: string;
};

function applyFeedFilter(
  posts: FeedPost[],
  filter: string,
): FeedPost[] {
  const f = (filter || "media").toLowerCase();
  if (f === "all") return posts;
  if (f === "original") {
    return posts.filter((p) => p.repostKind !== "retweet");
  }
  // media (default): anything with downloadable media (own or nested)
  return posts.filter((p) => p.mediaCount > 0);
}

function sortByDateDesc(posts: FeedPost[]): FeedPost[] {
  return [...posts].sort((a, b) => {
    const ta = a.postedAt ? Date.parse(a.postedAt) : 0;
    const tb = b.postedAt ? Date.parse(b.postedAt) : 0;
    return tb - ta;
  });
}

function cleanHandle(handle: string): string {
  return handle.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter|instagram|tiktok)\.com\/@?/i, "").split(/[/?#]/)[0] || "";
}

function asFeedPost(item: NormalizedScrape): FeedPost {
  const stored = (item as NormalizedScrape & { [FEED_ITEM]?: FeedPost })[FEED_ITEM];
  if (stored) return stored;
  const previewUrls = item.media
    .map((media) => media.previewUrl || media.fileUrl)
    .filter((url): url is string => Boolean(url))
    .slice(0, 4);
  let mediaType: FeedPost["mediaType"] = "text";
  if (item.postType === "carousel" || item.media.length > 1) mediaType = "carousel";
  else if (item.media.some((media) => media.type === "video") || item.postType === "video")
    mediaType = "video";
  else if (item.media.some((media) => media.type === "gif")) mediaType = "gif";
  else if (item.media.length) mediaType = "image";
  const handle = item.authorHandle.startsWith("@")
    ? item.authorHandle
    : `@${item.authorHandle}`;
  return {
    id: item.postId,
    platform: item.platform,
    url: item.url,
    handle,
    name: item.authorName,
    caption: item.caption,
    postedAt: item.postedAt,
    thumbnail: item.cover || previewUrls[0],
    previewUrls,
    mediaType,
    mediaCount: item.media.length,
    width: item.media[0]?.width,
    height: item.media[0]?.height,
    likes: item.likes,
    comments: item.comments,
    views: item.views,
    repostKind: item.repostKind,
    quotedHandle: item.quotedHandle,
  };
}

export async function listRecentPosts(input: {
  platform: Platform;
  handle: string;
  limit?: number;
  cursor?: string;
  /** all | media | original — default media for download workflows */
  filter?: string;
}): Promise<RecentPostsResult> {
  const handle = cleanHandle(input.handle);
  if (!handle) throw new Error("handle required");
  const limit = Math.min(50, Math.max(1, input.limit ?? 24));
  const filter = (input.filter || "media").toLowerCase();
  const scraper = await getScraper(connectionsEnv());
  const feed = (await scraper.fetchFeed(
    handle,
    input.platform,
    input.cursor,
  )) as ScrapeFeedPage;
  const posts = sortByDateDesc(feed.map(asFeedPost));
  const filtered = applyFeedFilter(posts, filter);
  return {
    ok: true,
    platform: input.platform,
    handle: `@${handle}`,
    note:
      input.platform === "x"
        ? "X only exposes a popular/sample feed via API (not full chronological Posts). Default view shows posts that have media (including quote/RT media). Switch filter to All if you need text-only."
        : undefined,
    creditsCharged: feed.creditsCharged,
    creditsRemaining: feed.creditsRemaining,
    posts: filtered.slice(0, limit),
    nextCursor: feed.nextCursor,
  };
}
