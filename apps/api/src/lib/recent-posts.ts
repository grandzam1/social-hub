import type { Platform } from "./types.js";
import {
  fetchInstagramUserPosts,
  fetchTikTokProfileVideos,
  fetchTwitterUserTweets,
} from "./scrapecreators.js";

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

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asNum(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function asStr(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function twitterDateToIso(raw?: string): string | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** GraphQL sometimes wraps Tweet in .result / .tweet */
function unwrapTweet(node: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!node) return null;
  if (asObj(node.tweet)) return unwrapTweet(asObj(node.tweet));
  if (asObj(node.result) && !node.legacy && !node.rest_id) {
    return unwrapTweet(asObj(node.result));
  }
  return node;
}

function xMediaList(tweet: Record<string, unknown> | null): unknown[] {
  if (!tweet) return [];
  const legacy = asObj(tweet.legacy) || {};
  return asArr(
    asObj(legacy.extended_entities)?.media ?? asObj(legacy.entities)?.media,
  );
}

function mapXTweet(raw: Record<string, unknown>, fallbackHandle: string): FeedPost | null {
  const tweet = unwrapTweet(raw) || raw;
  const legacy = asObj(tweet.legacy) || {};
  const core = asObj(tweet.core);
  const user = asObj(asObj(asObj(core?.user_results)?.result)?.legacy);
  const handle =
    asStr(user?.screen_name) ||
    fallbackHandle.replace(/^@/, "") ||
    "unknown";
  const id = asStr(tweet.rest_id) || asStr(legacy.id_str);
  if (!id) return null;

  const quoted = unwrapTweet(
    asObj(asObj(tweet.quoted_status_result)?.result) ||
      asObj(tweet.quoted_status),
  );
  const retweeted = unwrapTweet(
    asObj(asObj(legacy.retweeted_status_result)?.result) ||
      asObj(asObj(tweet.retweeted_status_result)?.result) ||
      asObj(legacy.retweeted_status) ||
      asObj(tweet.retweeted_status),
  );
  const repostKind: FeedPost["repostKind"] = quoted
    ? "quote"
    : retweeted
      ? "retweet"
      : undefined;

  let media = xMediaList(tweet);
  let mediaSource = tweet;
  if (!media.length && quoted) {
    media = xMediaList(quoted);
    mediaSource = quoted;
  }
  if (!media.length && retweeted) {
    media = xMediaList(retweeted);
    mediaSource = retweeted;
  }

  const first = asObj(media[0]);
  const orig = asObj(first?.original_info);
  const sizes = asObj(asObj(first?.sizes)?.large);
  let mediaType: FeedPost["mediaType"] = "text";
  if (media.length > 1) mediaType = "carousel";
  else if (first?.type === "video") mediaType = "video";
  else if (first?.type === "animated_gif") mediaType = "gif";
  else if (first?.type === "photo") mediaType = "image";

  let caption = asStr(legacy.full_text) || asStr(legacy.text) || "";
  caption = decodeEntities(caption);

  let quotedHandle: string | undefined;
  const nested = quoted || retweeted;
  if (nested) {
    const nUser = asObj(
      asObj(asObj(asObj(nested.core)?.user_results)?.result)?.legacy,
    );
    quotedHandle = asStr(nUser?.screen_name);
  }

  void mediaSource;

  const previewUrls = media
    .map((m) => asStr(asObj(m)?.media_url_https))
    .filter((u): u is string => Boolean(u))
    .slice(0, 4);

  return {
    id,
    platform: "x",
    url: asStr(tweet.url) || asStr(raw.url) || `https://x.com/${handle}/status/${id}`,
    handle: `@${handle}`,
    name: asStr(user?.name),
    caption,
    postedAt: twitterDateToIso(asStr(legacy.created_at)),
    thumbnail: previewUrls[0] || asStr(first?.media_url_https),
    previewUrls,
    mediaType,
    mediaCount: media.length,
    width: asNum(orig?.width) ?? asNum(sizes?.w),
    height: asNum(orig?.height) ?? asNum(sizes?.h),
    likes: asNum(legacy.favorite_count),
    comments: asNum(legacy.reply_count),
    views: asNum(asObj(tweet.views)?.count),
    repostKind,
    quotedHandle: quotedHandle ? `@${quotedHandle}` : undefined,
  };
}

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


function mapIgPost(raw: Record<string, unknown>, fallbackHandle: string): FeedPost | null {
  const code = asStr(raw.code) || asStr(raw.shortcode);
  const id = asStr(raw.id) || code;
  if (!id || !code) return null;
  const user = asObj(raw.user) || asObj(raw.owner);
  const handle =
    asStr(user?.username) || fallbackHandle.replace(/^@/, "") || "unknown";
  const captionObj = asObj(raw.caption);
  const caption = asStr(captionObj?.text) || asStr(raw.caption) || "";
  const mediaTypeNum = asNum(raw.media_type);
  const product = asStr(raw.product_type);
  let mediaType: FeedPost["mediaType"] = "image";
  if (mediaTypeNum === 8) mediaType = "carousel";
  else if (mediaTypeNum === 2 || product === "clips" || product === "reels")
    mediaType = "video";
  else if (mediaTypeNum === 1) mediaType = "image";

  const img = asObj(raw.image_versions2);
  const candidates = asArr(img?.candidates);
  const firstCand = asObj(candidates[0]);
  const carousel = asArr(raw.carousel_media);
  const previewUrls: string[] = [];
  const mainThumb = asStr(raw.display_uri) || asStr(firstCand?.url);
  if (mainThumb) previewUrls.push(mainThumb);
  for (const slide of carousel.slice(0, 4)) {
    const s = asObj(slide);
    const cands = asArr(asObj(s?.image_versions2)?.candidates);
    const u =
      asStr(s?.display_uri) ||
      asStr(asObj(cands[0])?.url) ||
      asStr(s?.thumbnail_url);
    if (u && !previewUrls.includes(u)) previewUrls.push(u);
  }

  return {
    id,
    platform: "instagram",
    url: asStr(raw.url) || `https://www.instagram.com/p/${code}/`,
    handle: `@${handle}`,
    name: asStr(user?.full_name),
    caption,
    postedAt: asStr(raw.created_at),
    thumbnail: previewUrls[0],
    previewUrls: previewUrls.slice(0, 4),
    mediaType,
    mediaCount: mediaType === "carousel" ? Math.max(1, carousel.length) : 1,
    width: asNum(firstCand?.width) ?? asNum(raw.original_width),
    height: asNum(firstCand?.height) ?? asNum(raw.original_height),
    likes: asNum(raw.like_count),
    comments: asNum(raw.comment_count),
    views: asNum(raw.play_count) ?? asNum(raw.ig_play_count),
  };
}


function firstBrowserSafeImage(urls: unknown[]): string | undefined {
  const list = urls.map((u) => asStr(u)).filter((u): u is string => Boolean(u));
  const safe = list.find((u) => !/\.heic(\?|$)/i.test(u));
  return safe || list[0];
}

function mapTtVideo(raw: Record<string, unknown>, fallbackHandle: string): FeedPost | null {
  const id = asStr(raw.aweme_id);
  if (!id) return null;
  const author = asObj(raw.author);
  const handle =
    asStr(author?.unique_id) ||
    asStr(author?.uniqueId) ||
    fallbackHandle.replace(/^@/, "") ||
    "unknown";
  const video = asObj(raw.video);
  const cover =
    asObj(video?.origin_cover) ||
    asObj(video?.cover) ||
    asObj(video?.dynamic_cover) ||
    asObj(video?.ai_dynamic_cover);
  const coverUrls = [
    ...asArr(cover?.url_list),
    asStr(cover?.url),
    ...asArr(asObj(video?.origin_cover)?.url_list),
    ...asArr(asObj(video?.cover)?.url_list),
    ...asArr(asObj(video?.dynamic_cover)?.url_list),
  ].filter(Boolean);
  const stats = asObj(raw.statistics) || {};
  const thumb = firstBrowserSafeImage(coverUrls);

  return {
    id,
    platform: "tiktok",
    url:
      asStr(raw.url) ||
      `https://www.tiktok.com/@${handle}/video/${id}`,
    handle: `@${handle}`,
    name: asStr(author?.nickname),
    caption: asStr(raw.desc) || "",
    postedAt: (() => {
      if (asStr(raw.create_time_utc)) {
        const d = new Date(String(raw.create_time_utc));
        if (!Number.isNaN(d.getTime())) return d.toISOString();
      }
      const unix = asNum(raw.create_time);
      return unix ? new Date(unix * 1000).toISOString() : undefined;
    })(),
    thumbnail: thumb,
    mediaType: "video",
    mediaCount: 1,
    width: asNum(video?.width) ?? asNum(asObj(video?.play_addr)?.width),
    height: asNum(video?.height) ?? asNum(asObj(video?.play_addr)?.height),
    likes: asNum(stats.digg_count),
    comments: asNum(stats.comment_count),
    views: asNum(stats.play_count),
  };
}

function cleanHandle(handle: string): string {
  return handle.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter|instagram|tiktok)\.com\/@?/i, "").split(/[/?#]/)[0] || "";
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

  if (input.platform === "x") {
    const raw = (await fetchTwitterUserTweets(handle)) as Record<string, unknown>;
    const tweets = sortByDateDesc(
      asArr(raw.tweets)
        .map((t) => mapXTweet(asObj(t) || {}, handle))
        .filter((p): p is FeedPost => Boolean(p)),
    );
    const filtered = applyFeedFilter(tweets, filter);
    return {
      ok: true,
      platform: "x",
      handle: `@${handle}`,
      note:
        "X only exposes a popular/sample feed via API (not full chronological Posts). Default view shows posts that have media (including quote/RT media). Switch filter to All if you need text-only.",
      creditsCharged: asNum(raw.credits_charged),
      creditsRemaining: asNum(raw.credits_remaining),
      posts: filtered.slice(0, limit),
    };
  }

  if (input.platform === "instagram") {
    const raw = (await fetchInstagramUserPosts(handle, input.cursor)) as Record<
      string,
      unknown
    >;
    const items = sortByDateDesc(
      asArr(raw.items)
        .map((t) => mapIgPost(asObj(t) || {}, handle))
        .filter((p): p is FeedPost => Boolean(p)),
    );
    const filtered = applyFeedFilter(items, filter);
    return {
      ok: true,
      platform: "instagram",
      handle: `@${handle}`,
      creditsCharged: asNum(raw.credits_charged),
      creditsRemaining: asNum(raw.credits_remaining),
      posts: filtered.slice(0, limit),
      nextCursor: asStr(raw.next_max_id),
    };
  }

  const raw = (await fetchTikTokProfileVideos(handle, {
    maxCursor: input.cursor,
    sortBy: "latest",
  })) as Record<string, unknown>;
  const items = sortByDateDesc(
    asArr(raw.aweme_list)
      .map((t) => mapTtVideo(asObj(t) || {}, handle))
      .filter((p): p is FeedPost => Boolean(p)),
  );
  const filtered = applyFeedFilter(items, filter);
  return {
    ok: true,
    platform: "tiktok",
    handle: `@${handle}`,
    creditsCharged: asNum(raw.credits_charged),
    creditsRemaining: asNum(raw.credits_remaining),
    posts: filtered.slice(0, limit),
    nextCursor: raw.has_more ? asStr(raw.max_cursor) : undefined,
  };
}
