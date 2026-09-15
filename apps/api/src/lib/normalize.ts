import type { NormalizedMedia, NormalizedScrape, Platform } from "./types.js";

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function asStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

/** Twitter "Thu Aug 13 22:58:33 +0000 2026" → ISO for Airtable. */
function asIsoDate(v: unknown): string | undefined {
  const s = asStr(v);
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return undefined;
}

/** Avoid multi-hundred-MB masters for day-to-day saves. */
function pickPracticalMp4(
  mp4s: Array<Record<string, unknown> | null>,
): string | undefined {
  const rows = mp4s
    .filter(Boolean)
    .map((v) => {
      const url = asStr(v!.url) || "";
      const br = asNum(v!.bitrate) ?? 0;
      let score = br;
      if (/\/720x|720x\d+/.test(url)) score += 4_000_000;
      if (/\/480x|480x\d+/.test(url)) score += 1_500_000;
      // Penalize very high bitrates (often 50–150MB files)
      if (br > 6_000_000) score -= br;
      return { url, br, score };
    })
    .filter((r) => r.url)
    .sort((a, b) => b.score - a.score);
  return rows[0]?.url;
}

function asNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v)))
    return Number(v);
  return undefined;
}

function nest(root: Record<string, unknown>, ...keys: string[]) {
  let cur: unknown = root;
  for (const k of keys) {
    const o = asObj(cur);
    if (!o) return null;
    cur = o[k];
  }
  return cur;
}

function platformLabel(p: Platform): string {
  if (p === "x") return "x";
  return p;
}

export function normalizeInstagram(
  raw: Record<string, unknown>,
  url: string,
): NormalizedScrape {
  const media =
    asObj(nest(raw, "data", "xdt_shortcode_media")) ||
    asObj(raw.data) ||
    asObj(raw);
  if (!media) throw new Error("Instagram response missing post media");

  const shortcode =
    asStr(media.shortcode) ||
    url.match(/\/(?:p|reel|reels)\/([^/?#]+)/i)?.[1] ||
    asStr(media.id) ||
    "unknown";
  const owner = asObj(media.owner) || {};
  const edges = Array.isArray(nest(media, "edge_media_to_caption", "edges"))
    ? (nest(media, "edge_media_to_caption", "edges") as unknown[])
    : [];
  const caption =
    asStr(asObj(asObj(edges[0])?.node)?.text) ||
    asStr(asObj(media.caption)?.text) ||
    "";

  const likes =
    asNum(nest(media, "edge_media_preview_like", "count")) ??
    asNum(media.like_count);
  const comments =
    asNum(nest(media, "edge_media_to_parent_comment", "count")) ??
    asNum(nest(media, "edge_media_preview_comment", "count")) ??
    asNum(media.comment_count);
  const views =
    asNum(media.video_play_count) ?? asNum(media.video_view_count);
  const durationSec = asNum(media.video_duration);
  const cover =
    asStr(media.display_url) ||
    asStr(media.thumbnail_src) ||
    asStr(media.display_uri);
  const isVideo = Boolean(media.is_video) || Boolean(asStr(media.video_url));

  const assets: NormalizedMedia[] = [];
  const sidecar = asObj(media.edge_sidecar_to_children);
  const children = Array.isArray(sidecar?.edges) ? (sidecar!.edges as unknown[]) : [];

  if (children.length) {
    children.forEach((edge, i) => {
      const node = asObj(asObj(edge)?.node) || {};
      const vid = asStr(node.video_url);
      const img = asStr(node.display_url);
      const fileUrl = vid || img;
      if (!fileUrl) return;
      assets.push({
        mediaId: `${shortcode}_${i}`,
        order: i, // 0-based carousel sequence
        type: vid ? "video" : "image",
        fileUrl,
        previewUrl: img || cover,
        fileType: vid ? "video/mp4" : "image/jpeg",
      });
    });
  } else {
    const fileUrl = asStr(media.video_url) || cover;
    if (fileUrl) {
      assets.push({
        mediaId: `${shortcode}_0`,
        order: 0,
        type: isVideo ? "video" : "image",
        fileUrl,
        previewUrl: cover,
        durationMs: durationSec ? Math.round(durationSec * 1000) : undefined,
        fileType: isVideo ? "video/mp4" : "image/jpeg",
      });
    }
  }

  const handle = asStr(owner.username) || "unknown";
  return {
    platform: "instagram",
    postId: shortcode,
    url: url.includes("instagram.com")
      ? url
      : `https://www.instagram.com/p/${shortcode}/`,
    caption,
    authorHandle: handle.startsWith("@") ? handle : `@${handle}`,
    authorName: asStr(owner.full_name),
    authorAvatar: asStr(owner.profile_pic_url),
    authorVerified: Boolean(owner.is_verified),
    authorFollowers: asNum(nest(owner, "edge_followed_by", "count")),
    platformUserId: asStr(owner.id),
    likes,
    comments,
    views,
    postedAt: asStr(media.created_at) ||
      (asNum(media.taken_at_timestamp)
        ? new Date(asNum(media.taken_at_timestamp)! * 1000).toISOString()
        : undefined),
    durationSec,
    postType: isVideo ? "reel" : assets.length > 1 ? "carousel" : "image",
    cover,
    media: assets,
    creditsCharged: asNum(raw.credits_charged),
    creditsRemaining: asNum(raw.credits_remaining),
    cached: Boolean(raw.cached),
  };
}

export function normalizeTikTok(
  raw: Record<string, unknown>,
  url: string,
): NormalizedScrape {
  const aweme =
    asObj(raw.aweme_detail) ||
    asObj(raw.data) ||
    asObj(nest(raw, "data", "aweme_detail")) ||
    raw;
  const a = asObj(aweme) || {};
  const author = asObj(a.author) || asObj(raw.author) || {};
  const stats = asObj(a.statistics) || asObj(raw.stats) || {};
  const video = asObj(a.video) || {};
  const music = asObj(a.music) || {};

  const postId =
    asStr(a.aweme_id) ||
    asStr(raw.id) ||
    url.match(/video\/(\d+)/)?.[1] ||
    "unknown";

  const handle =
    asStr(author.unique_id) || asStr(author.uniqueId) || "unknown";

  const playAddr = asObj(video.play_addr) || asObj(video.playAddr);
  const urlList = Array.isArray(playAddr?.url_list)
    ? (playAddr!.url_list as unknown[])
    : Array.isArray(playAddr?.urlList)
      ? (playAddr!.urlList as unknown[])
      : [];
  const downloadAddr = asObj(video.download_addr);
  const downloadList = Array.isArray(downloadAddr?.url_list)
    ? (downloadAddr!.url_list as unknown[])
    : [];
  const fileUrl =
    asStr(urlList[0]) ||
    asStr(downloadList[0]) ||
    asStr(raw.video_url) ||
    asStr(raw.play);

  const coverObj = asObj(video.cover) || asObj(video.origin_cover);
  const coverList = Array.isArray(coverObj?.url_list)
    ? (coverObj!.url_list as unknown[])
    : [];
  const cover = asStr(coverList[0]) || asStr(raw.cover) || asStr(raw.thumbnail);

  const media: NormalizedMedia[] = [];
  if (fileUrl) {
    media.push({
      mediaId: `${postId}_0`,
      order: 0,
      type: "video",
      fileUrl,
      previewUrl: cover,
      durationMs: asNum(video.duration) ?? asNum(a.duration),
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

  const caption =
    asStr(a.desc) || asStr(raw.desc) || asStr(raw.description) || "";

  return {
    platform: "tiktok",
    postId,
    url,
    caption,
    authorHandle: handle.startsWith("@") ? handle : `@${handle}`,
    authorName: asStr(author.nickname) || asStr(author.nick_name),
    authorAvatar: (() => {
      const larger = asObj(author.avatar_larger);
      const list = Array.isArray(larger?.url_list)
        ? (larger!.url_list as unknown[])
        : [];
      return asStr(list[0]) || asStr(author.avatar);
    })(),
    authorVerified: Boolean(author.custom_verify) || Boolean(author.verified),
    authorFollowers: asNum(author.follower_count),
    platformUserId: asStr(author.uid) || asStr(author.id),
    likes: asNum(stats.digg_count) ?? asNum(stats.diggCount) ?? asNum(raw.likes),
    comments:
      asNum(stats.comment_count) ??
      asNum(stats.commentCount) ??
      asNum(raw.comments),
    shares:
      asNum(stats.share_count) ?? asNum(stats.shareCount) ?? asNum(raw.shares),
    views:
      asNum(stats.play_count) ?? asNum(stats.playCount) ?? asNum(raw.views),
    saves: asNum(stats.collect_count),
    postedAt: asNum(a.create_time)
      ? new Date(asNum(a.create_time)! * 1000).toISOString()
      : undefined,
    durationSec: asNum(video.duration)
      ? asNum(video.duration)! > 1000
        ? asNum(video.duration)! / 1000
        : asNum(video.duration)
      : undefined,
    postType: "video",
    cover,
    media,
    creditsCharged: asNum(raw.credits_charged),
    creditsRemaining: asNum(raw.credits_remaining),
    cached: Boolean(raw.cached),
  };
}

export function normalizeX(
  raw: Record<string, unknown>,
  url: string,
): NormalizedScrape {
  // ScrapeCreators may return classic tweet OR GraphQL Tweet (legacy + core)
  const tweet =
    asObj(raw.tweet) ||
    asObj(raw.data) ||
    asObj(nest(raw, "data", "tweet")) ||
    raw;
  const t = asObj(tweet) || {};
  const legacy = asObj(t.legacy) || {};
  const userResult =
    asObj(nest(t, "core", "user_results", "result")) ||
    asObj(t.user) ||
    asObj(t.author) ||
    asObj(raw.user) ||
    {};
  const userCore = asObj(userResult.core) || {};
  const userLegacy = asObj(userResult.legacy) || {};
  const user = { ...userLegacy, ...userResult, ...userCore };

  const postId =
    asStr(t.rest_id) ||
    asStr(legacy.id_str) ||
    asStr(t.id_str) ||
    asStr(t.id) ||
    url.match(/status\/(\d+)/)?.[1] ||
    "unknown";

  const handle =
    asStr(userCore.screen_name) ||
    asStr(user.screen_name) ||
    asStr(user.username) ||
    asStr(user.handle) ||
    "unknown";

  let caption =
    asStr(legacy.full_text) ||
    asStr(t.full_text) ||
    asStr(t.text) ||
    "";

  // Nested quote / retweet (GraphQL)
  const quoted =
    asObj(nest(t, "quoted_status_result", "result")) ||
    asObj(nest(raw, "quoted_status_result", "result")) ||
    asObj(t.quoted_status) ||
    null;
  const retweeted =
    asObj(nest(t, "retweeted_status_result", "result")) ||
    asObj(nest(legacy, "retweeted_status_result", "result")) ||
    asObj(nest(raw, "retweeted_status_result", "result")) ||
    asObj(t.retweeted_status) ||
    asObj(legacy.retweeted_status) ||
    null;

  const nested = quoted || retweeted;
  const repostKind: "quote" | "retweet" | undefined = quoted
    ? "quote"
    : retweeted
      ? "retweet"
      : undefined;

  let quotedHandle: string | undefined;
  let quotedText: string | undefined;
  if (nested) {
    const nLegacy = asObj(nested.legacy) || nested;
    const nUser =
      asObj(nest(nested, "core", "user_results", "result")) ||
      asObj(nested.user) ||
      {};
    const nCore = asObj(nUser.core) || nUser;
    quotedHandle =
      asStr(nCore.screen_name) ||
      asStr(nUser.screen_name) ||
      asStr(nUser.username);
    quotedText =
      asStr(nLegacy.full_text) || asStr(nested.full_text) || asStr(nested.text);
    if (quotedText) {
      const who = quotedHandle ? `@${quotedHandle.replace(/^@/, "")}` : "quoted";
      caption = caption
        ? `${caption}\n\n—— ${repostKind === "retweet" ? "RT" : "QT"} ${who} ——\n${quotedText}`
        : quotedText;
    }
  }

  // Own media first; if none (typical QT/RT), fall through to nested status media
  let media = extractXMedia(t, postId);
  if (!media.length && nested) {
    const nestedId =
      asStr(nested.rest_id) ||
      asStr(asObj(nested.legacy)?.id_str) ||
      `${postId}_nested`;
    media = extractXMedia(nested, `${postId}_qt`).map((m, i) => ({
      ...m,
      mediaId: `${postId}_${i}`,
      order: i,
    }));
    void nestedId;
  }

  if (!media.length) {
    const flat =
      asStr(t.video_url) ||
      asStr(raw.video_url) ||
      asStr(t.media_url) ||
      asStr(raw.media_url);
    if (flat) {
      const isVid = flat.includes(".mp4") || flat.includes("video");
      media.push({
        mediaId: `${postId}_0`,
        order: 0,
        type: isVid ? "video" : "image",
        fileUrl: flat,
        previewUrl: asStr(t.thumbnail_url) || asStr(raw.thumbnail_url),
        fileType: isVid ? "video/mp4" : "image/jpeg",
      });
    }
  }

  const viewsCount =
    asNum(asObj(t.views)?.count) ||
    asNum(t.views) ||
    asNum(t.view_count);

  const postType = media.some((m) => m.type === "video")
    ? repostKind
      ? `${repostKind}_video`
      : "video"
    : media.length
      ? repostKind
        ? `${repostKind}_image`
        : media.length > 1
          ? "carousel"
          : "image"
      : repostKind || "text";

  return {
    platform: "x",
    postId,
    url,
    caption,
    authorHandle: handle.startsWith("@") ? handle : `@${handle}`,
    authorName: asStr(userCore.name) || asStr(user.name),
    authorAvatar:
      asStr(asObj(userResult.avatar)?.image_url) ||
      asStr(user.profile_image_url_https) ||
      asStr(user.avatar),
    authorVerified:
      Boolean(userResult.is_blue_verified) || Boolean(user.verified),
    authorFollowers:
      asNum(userLegacy.followers_count) ||
      asNum(user.followers_count) ||
      asNum(user.followers),
    platformUserId:
      asStr(userResult.rest_id) || asStr(user.id_str) || asStr(user.id),
    likes:
      asNum(legacy.favorite_count) ||
      asNum(t.favorite_count) ||
      asNum(t.likes) ||
      asNum(raw.likes),
    comments:
      asNum(legacy.reply_count) ||
      asNum(t.reply_count) ||
      asNum(t.replies),
    shares:
      asNum(legacy.retweet_count) ||
      asNum(t.retweet_count) ||
      asNum(t.reposts),
    views: viewsCount,
    postedAt: asIsoDate(legacy.created_at) || asIsoDate(t.created_at),
    postType,
    repostKind,
    quotedHandle: quotedHandle
      ? quotedHandle.startsWith("@")
        ? quotedHandle
        : `@${quotedHandle}`
      : undefined,
    quotedText,
    cover: media[0]?.previewUrl || media[0]?.fileUrl,
    media,
    creditsCharged: asNum(raw.credits_charged),
    creditsRemaining: asNum(raw.credits_remaining),
    cached: Boolean(raw.cached),
  };
}

/** Pull image/video assets from a GraphQL or classic tweet object. */
function extractXMedia(
  tweetObj: Record<string, unknown>,
  postId: string,
): NormalizedMedia[] {
  const legacy = asObj(tweetObj.legacy) || {};
  const entities =
    asObj(legacy.extended_entities) ||
    asObj(tweetObj.extended_entities) ||
    asObj(legacy.entities) ||
    asObj(tweetObj.entities) ||
    {};
  const mediaArr = Array.isArray(entities.media)
    ? (entities.media as unknown[])
    : [];
  const out: NormalizedMedia[] = [];

  mediaArr.forEach((m, i) => {
    const item = asObj(m) || {};
    const typeRaw = asStr(item.type) || "photo";
    let fileUrl = asStr(item.media_url_https) || asStr(item.media_url);
    let type: NormalizedMedia["type"] = "image";
    if (typeRaw === "video" || typeRaw === "animated_gif") {
      type = typeRaw === "animated_gif" ? "gif" : "video";
      const variants = Array.isArray(asObj(item.video_info)?.variants)
        ? (asObj(item.video_info)!.variants as unknown[])
        : [];
      const mp4s = variants
        .map((v) => asObj(v))
        .filter((v) => v && asStr(v.content_type)?.includes("mp4"));
      const picked = pickPracticalMp4(mp4s);
      if (picked) fileUrl = picked;
    }
    if (!fileUrl) return;
    const original = asObj(item.original_info) || asObj(item.originalInfo);
    const sizes = asObj(item.sizes);
    const large = asObj(sizes?.large);
    out.push({
      mediaId: `${postId}_${i}`,
      order: i,
      type,
      fileUrl,
      previewUrl: asStr(item.media_url_https) || asStr(item.media_url),
      width:
        asNum(original?.width) || asNum(large?.w) || asNum(item.width),
      height:
        asNum(original?.height) || asNum(large?.h) || asNum(item.height),
      durationMs: asNum(asObj(item.video_info)?.duration_millis),
      fileType: type === "video" || type === "gif" ? "video/mp4" : "image/jpeg",
    });
  });

  return out;
}

export { platformLabel };
