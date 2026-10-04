import { getConnection, type ConnectionsEnv } from "../../connections/index.js";
import {
  assertSinglePostUrl,
  detectPlatform,
} from "../../lib/scrapecreators.js";
import type {
  NormalizedMedia,
  NormalizedScrape,
  Platform,
} from "../../lib/types.js";
import type { ScrapeProvider } from "../types.js";

const PROJECT = "social-hub";

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function asNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

async function connection(env: ConnectionsEnv, name: string): Promise<string> {
  const value = (await getConnection(env, PROJECT, name))?.trim();
  if (value) return value;
  if (name === "apify") {
    const fromEnv = process.env.APIFY_TOKEN?.trim();
    if (fromEnv) return fromEnv;
  }
  throw new Error(`Missing connection "${name}" for project "${PROJECT}".`);
}

function actorSetting(platform: Platform): string {
  if (platform === "instagram") return "apify_actor_instagram";
  if (platform === "tiktok") return "apify_actor_tiktok";
  return "apify_actor_x";
}

function actorIdPath(id: string): string {
  return encodeURIComponent(id.trim().replace(/\//g, "~"));
}

async function runActor(
  token: string,
  actorId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const url = `https://api.apify.com/v2/acts/${actorIdPath(actorId)}/run-sync-get-dataset-items?timeout=300`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(310_000),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Apify ${actorId}: non-JSON ${res.status} ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(
      `Apify ${actorId}: ${res.status} ${JSON.stringify(body).slice(0, 400)}`,
    );
  }
  const items = Array.isArray(body)
    ? body
    : Array.isArray((body as { items?: unknown }).items)
      ? (body as { items: unknown[] }).items
      : null;
  if (!items) {
    throw new Error(`Apify ${actorId}: expected a dataset array`);
  }
  return items.map((item) => asObj(item) || {});
}

function postInput(platform: Platform, url: string): Record<string, unknown> {
  if (platform === "instagram") {
    return { directUrls: [url], resultsType: "posts", resultsLimit: 1 };
  }
  if (platform === "tiktok") {
    return { postURLs: [url], resultsPerPage: 1, shouldDownloadVideos: false };
  }
  return { startUrls: [url], maxItems: 1 };
}

function feedInput(platform: Platform, handle: string): Record<string, unknown> {
  const bare = handle.replace(/^@/, "");
  if (platform === "instagram") {
    return {
      directUrls: [`https://www.instagram.com/${bare}/`],
      resultsType: "posts",
      resultsLimit: 24,
    };
  }
  if (platform === "tiktok") {
    return {
      profiles: [bare],
      resultsPerPage: 24,
      profileScrapeSections: ["videos"],
      profileSorting: "latest",
      shouldDownloadVideos: false,
    };
  }
  return {
    startUrls: [`https://x.com/${bare}`],
    maxItems: 24,
    sort: "Latest",
  };
}

function handleOf(value: string | undefined): string {
  const handle = value?.replace(/^@/, "") || "unknown";
  return `@${handle}`;
}

export function normalizeApifyInstagram(
  raw: Record<string, unknown>,
  url: string,
): NormalizedScrape {
  const shortcode =
    asStr(raw.shortCode) ||
    asStr(raw.shortcode) ||
    url.match(/\/(?:p|reel|reels)\/([^/?#]+)/i)?.[1] ||
    asStr(raw.id) ||
    "unknown";
  const owner = asObj(raw.owner) || {};
  const handle = asStr(raw.ownerUsername) || asStr(owner.username) || "unknown";
  const children = Array.isArray(raw.childPosts)
    ? raw.childPosts
    : Array.isArray(raw.sidecarChildren)
      ? raw.sidecarChildren
      : [];
  const imageUrls = (Array.isArray(raw.images) ? raw.images : [])
    .map((item) => asStr(item) || asStr(asObj(item)?.url) || asStr(asObj(item)?.displayUrl))
    .filter((item): item is string => Boolean(item));
  const cover = asStr(raw.displayUrl) || asStr(raw.display_url) || imageUrls[0];
  const videoUrl = asStr(raw.videoUrl) || asStr(raw.video_url);
  const assets: NormalizedMedia[] = [];

  if (children.length) {
    children.forEach((child, i) => {
      const node = asObj(child) || {};
      const vid = asStr(node.videoUrl) || asStr(node.video_url);
      const img = asStr(node.displayUrl) || asStr(node.display_url);
      const fileUrl = vid || img;
      if (!fileUrl) return;
      assets.push({
        mediaId: `${shortcode}_${i}`,
        order: i,
        type: vid ? "video" : "image",
        fileUrl,
        previewUrl: img || cover,
        width: asNum(node.dimensionsWidth),
        height: asNum(node.dimensionsHeight),
        fileType: vid ? "video/mp4" : "image/jpeg",
      });
    });
  } else if (imageUrls.length > 1 && !videoUrl) {
    imageUrls.forEach((fileUrl, i) => {
      assets.push({
        mediaId: `${shortcode}_${i}`,
        order: i,
        type: "image",
        fileUrl,
        previewUrl: fileUrl,
        fileType: "image/jpeg",
      });
    });
  } else {
    const fileUrl = videoUrl || cover;
    if (fileUrl) {
      assets.push({
        mediaId: `${shortcode}_0`,
        order: 0,
        type: videoUrl ? "video" : "image",
        fileUrl,
        previewUrl: cover,
        width: asNum(raw.dimensionsWidth),
        height: asNum(raw.dimensionsHeight),
        durationMs: asNum(raw.videoDuration)
          ? Math.round(asNum(raw.videoDuration)! * 1000)
          : undefined,
        fileType: videoUrl ? "video/mp4" : "image/jpeg",
      });
    }
  }

  const typeRaw = (asStr(raw.type) || "").toLowerCase();
  const postType = videoUrl || typeRaw === "video" || typeRaw === "clips"
    ? "reel"
    : assets.length > 1 || typeRaw === "sidecar"
      ? "carousel"
      : "image";
  const verified = raw.ownerIsVerified ?? owner.is_verified;

  return {
    platform: "instagram",
    postId: shortcode,
    url: asStr(raw.url) || url,
    caption: asStr(raw.caption) || "",
    authorHandle: handleOf(handle),
    authorName: asStr(raw.ownerFullName) || asStr(owner.full_name),
    authorAvatar: asStr(raw.ownerProfilePicUrl) || asStr(owner.profile_pic_url),
    authorVerified: verified == null ? undefined : Boolean(verified),
    authorFollowers: asNum(raw.ownerFollowers ?? owner.followers),
    platformUserId: asStr(raw.ownerId) || asStr(owner.id),
    likes: asNum(raw.likesCount) ?? asNum(raw.likes),
    comments: asNum(raw.commentsCount) ?? asNum(raw.comments),
    views: asNum(raw.videoViewCount) ?? asNum(raw.videoPlayCount),
    postedAt: asStr(raw.timestamp) || asStr(raw.takenAt),
    durationSec: asNum(raw.videoDuration),
    postType,
    cover,
    media: assets,
  };
}

export function normalizeApifyTikTok(
  raw: Record<string, unknown>,
  url: string,
): NormalizedScrape {
  const author = asObj(raw.authorMeta) || asObj(raw.author) || {};
  const video = asObj(raw.videoMeta) || asObj(raw.video) || {};
  const mediaUrls = Array.isArray(raw.mediaUrls) ? raw.mediaUrls : [];
  const postId =
    asStr(raw.id) || asStr(raw.aweme_id) || url.match(/video\/(\d+)/)?.[1] || "unknown";
  const handle = asStr(author.name) || asStr(author.uniqueId) || asStr(raw.authorName) || "unknown";
  const fileUrl =
    asStr(mediaUrls[0]) ||
    asStr(raw.videoUrl) ||
    asStr(video.downloadAddr) ||
    asStr(video.playUrl);
  const cover =
    asStr(video.coverUrl) ||
    asStr(video.originalCoverUrl) ||
    asStr(raw.coverUrl);
  const media: NormalizedMedia[] = [];
  if (fileUrl) {
    media.push({
      mediaId: `${postId}_0`,
      order: 0,
      type: "video",
      fileUrl,
      previewUrl: cover,
      width: asNum(video.width),
      height: asNum(video.height),
      durationMs: asNum(video.duration) ? Math.round(asNum(video.duration)! * 1000) : undefined,
      fileType: "video/mp4",
    });
  } else if (cover) {
    media.push({
      mediaId: `${postId}_0`,
      order: 0,
      type: "image",
      fileUrl: cover,
      previewUrl: cover,
      fileType: "image/jpeg",
    });
  }
  const duration = asNum(video.duration);
  return {
    platform: "tiktok",
    postId,
    url: asStr(raw.webVideoUrl) || asStr(raw.url) || url,
    caption: asStr(raw.text) || asStr(raw.desc) || "",
    authorHandle: handleOf(handle),
    authorName: asStr(author.nickName) || asStr(author.nickname),
    authorAvatar: asStr(author.avatar) || asStr(author.avatarUrl),
    authorVerified: Boolean(author.verified),
    authorFollowers: asNum(author.fans) ?? asNum(author.followers),
    platformUserId: asStr(author.id),
    likes: asNum(raw.diggCount) ?? asNum(raw.likes),
    comments: asNum(raw.commentCount) ?? asNum(raw.comments),
    shares: asNum(raw.shareCount),
    views: asNum(raw.playCount) ?? asNum(raw.views),
    saves: asNum(raw.collectCount),
    postedAt: asStr(raw.createTimeISO) || asStr(raw.postedAt),
    durationSec: duration,
    postType: "video",
    cover,
    media,
  };
}

export function normalizeApifyX(
  raw: Record<string, unknown>,
  url: string,
): NormalizedScrape {
  const author = asObj(raw.author) || asObj(raw.user) || {};
  const extended = asObj(raw.extendedEntities) || asObj(raw.extended_entities) || {};
  const entities = asObj(raw.entities) || {};
  const mediaRaw = Array.isArray(raw.media)
    ? raw.media
    : Array.isArray(extended.media)
      ? extended.media
      : Array.isArray(entities.media)
        ? entities.media
        : [];
  const postId =
    asStr(raw.id) || asStr(raw.id_str) || url.match(/status\/(\d+)/)?.[1] || "unknown";
  const handle =
    asStr(author.userName) || asStr(author.username) || asStr(author.screen_name) || "unknown";
  const assets: NormalizedMedia[] = [];
  mediaRaw.forEach((item, i) => {
    const node = asObj(item) || {};
    const typeRaw = (asStr(node.type) || "photo").toLowerCase();
    let fileUrl = asStr(node.media_url_https) || asStr(node.url) || asStr(node.mediaUrl);
    let type: NormalizedMedia["type"] = "image";
    if (typeRaw === "video" || typeRaw === "animated_gif") {
      type = typeRaw === "animated_gif" ? "gif" : "video";
      const variants = Array.isArray(asObj(node.video_info)?.variants)
        ? (asObj(node.video_info)!.variants as unknown[])
        : [];
      const mp4 = variants
        .map((variant) => asObj(variant))
        .filter((variant) => variant && asStr(variant.content_type)?.includes("mp4"))
        .sort((a, b) => (asNum(b?.bitrate) ?? 0) - (asNum(a?.bitrate) ?? 0))[0];
      fileUrl = asStr(mp4?.url) || fileUrl;
    }
    if (!fileUrl) return;
    assets.push({
      mediaId: `${postId}_${i}`,
      order: i,
      type,
      fileUrl,
      previewUrl: asStr(node.media_url_https) || asStr(node.previewUrl) || fileUrl,
      width: asNum(node.width),
      height: asNum(node.height),
      fileType: type === "image" ? "image/jpeg" : "video/mp4",
    });
  });
  const postType = assets.some((item) => item.type === "video")
    ? "video"
    : assets.length > 1
      ? "carousel"
      : assets.length
        ? "image"
        : "text";
  return {
    platform: "x",
    postId,
    url: asStr(raw.url) || asStr(raw.twitterUrl) || url,
    caption: asStr(raw.text) || asStr(raw.full_text) || "",
    authorHandle: handleOf(handle),
    authorName: asStr(author.name),
    authorAvatar: asStr(author.profilePicture) || asStr(author.profile_image_url),
    authorVerified: Boolean(author.isBlueVerified ?? author.isVerified ?? author.verified),
    authorFollowers: asNum(author.followers) ?? asNum(author.followersCount),
    platformUserId: asStr(author.id),
    likes: asNum(raw.likeCount) ?? asNum(raw.favorite_count),
    comments: asNum(raw.replyCount) ?? asNum(raw.reply_count),
    shares: asNum(raw.retweetCount) ?? asNum(raw.retweet_count),
    views: asNum(raw.viewCount) ?? asNum(raw.views),
    postedAt: asStr(raw.createdAt) || asStr(raw.created_at),
    postType,
    cover: assets[0]?.previewUrl || assets[0]?.fileUrl,
    media: assets,
  };
}

function normalizeItem(
  platform: Platform,
  raw: Record<string, unknown>,
  url: string,
): NormalizedScrape {
  if (platform === "instagram") return normalizeApifyInstagram(raw, url);
  if (platform === "tiktok") return normalizeApifyTikTok(raw, url);
  return normalizeApifyX(raw, url);
}

export function createApifyProvider(env: ConnectionsEnv): ScrapeProvider {
  return {
    name: "apify",
    async fetchPost(url: string) {
      const platform = detectPlatform(url);
      assertSinglePostUrl(url, platform);
      const token = await connection(env, "apify");
      const actorId = await connection(env, actorSetting(platform));
      const items = await runActor(token, actorId, postInput(platform, url));
      const first = items.find((item) => Object.keys(item).length);
      if (!first) {
        throw new Error(`Apify actor "${actorId}" returned no items for ${url}`);
      }
      return normalizeItem(platform, first, url);
    },
    async fetchFeed(handle: string, platform: Platform) {
      const token = await connection(env, "apify");
      const actorId = await connection(env, actorSetting(platform));
      const bare = handle.replace(/^@/, "");
      const items = await runActor(token, actorId, feedInput(platform, bare));
      const pageUrl =
        platform === "instagram"
          ? `https://www.instagram.com/${bare}/`
          : platform === "tiktok"
            ? `https://www.tiktok.com/@${bare}`
            : `https://x.com/${bare}`;
      return items
        .filter((item) => Object.keys(item).length)
        .map((item) => normalizeItem(platform, item, asStr(item.url) || pageUrl));
    },
    async getCredits() {
      const token = await connection(env, "apify");
      const res = await fetch("https://api.apify.com/v2/users/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Apify users/me: ${res.status} ${text.slice(0, 200)}`);
      }
      return { remaining: null };
    },
  };
}
