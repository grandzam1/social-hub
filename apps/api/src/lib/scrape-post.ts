import {
  findProfile,
  upsertMedia,
  upsertPost,
  upsertProfile,
  updatePost,
} from "./airtable.js";
import {
  detectPlatform,
  assertSinglePostUrl,
  scrapeInstagramPost,
  scrapeTikTokVideo,
  scrapeTwitterTweet,
} from "./scrapecreators.js";
import {
  normalizeInstagram,
  normalizeTikTok,
  normalizeX,
} from "./normalize.js";
import { recordMediaSaveFailure, saveMediaCdnToR2 } from "./save-media.js";
import { saveStatusFields } from "./save-status.js";
import type { NormalizedScrape } from "./types.js";
import { queueMediaSaves } from "./queue-media-save.js";
import { isHostedMediaUrl } from "./r2.js";
import { saveAvatarToR2 } from "./profile-avatar.js";
import { invalidateLibrary } from "./library-cache.js";

export type ScrapePostInput = {
  url: string;
  /** Download CDN → R2 and set Saved copy (default true). */
  saveToR2?: boolean;
  /**
   * sync = wait in request (good for 1 file).
   * async = batch queue to Inngest (default for carousels / multi-media).
   * omit = auto (async when media.length > 1).
   */
  saveMode?: "sync" | "async";
  force?: boolean;
};

export type ScrapePostResult = {
  ok: true;
  platform: NormalizedScrape["platform"];
  profile: { id: string; handle: string; name?: string; avatar?: string };
  post: {
    id: string;
    postId: string;
    text: string;
    link: string;
    status: string;
    postType?: string;
    repostKind?: "quote" | "retweet";
    quotedHandle?: string;
    likes?: number;
    comments?: number;
    shares?: number;
    views?: number;
    durationSec?: number;
    mediaCount: number;
  };
  media: Array<{
    id: string;
    mediaId: string;
    order: number;
    type: string;
    fileLink: string;
    previewLink?: string;
    savedCopy?: string;
    fileStatus: string;
    width?: number;
    height?: number;
    durationMs?: number;
    save?: unknown;
  }>;
  saveMode: "sync" | "async" | "none";
  saved?: boolean;
  reason?: "queue_failed";
  creditsCharged?: number;
  creditsRemaining?: number;
  cached?: boolean;
};

export async function scrapePostPipeline(
  input: ScrapePostInput,
): Promise<ScrapePostResult> {
  // One request must make a small, fixed number of outbound calls.
  // Anything that grows with slides or posts goes into a job.
  const url = String(input.url || "").trim();
  if (!url) throw new Error("url required");

  const platform = detectPlatform(url);
  assertSinglePostUrl(url, platform);
  let raw: Record<string, unknown>;
  let normalized: NormalizedScrape;

  if (platform === "instagram") {
    raw = await scrapeInstagramPost(url);
    normalized = normalizeInstagram(raw, url);
  } else if (platform === "tiktok") {
    raw = await scrapeTikTokVideo(url);
    normalized = normalizeTikTok(raw, url);
  } else {
    raw = await scrapeTwitterTweet(url);
    normalized = normalizeX(raw, url);
  }

  // Ensure stable 0..n-1 order even if a normalizer gaps
  normalized.media = [...normalized.media]
    .sort((a, b) => a.order - b.order)
    .map((m, i) => ({ ...m, order: i }));

  const existingProfile = await findProfile(
    normalized.authorHandle,
    normalized.platform,
  );
  const existingAvatar = String(existingProfile?.fields.Avatar ?? "");
  let avatar = isHostedMediaUrl(existingAvatar) ? existingAvatar : "";
  if (!avatar && normalized.authorAvatar) {
    try {
      avatar = await saveAvatarToR2({
        platform: normalized.platform,
        handle: normalized.authorHandle,
        sourceUrl: normalized.authorAvatar,
      });
    } catch {
      avatar = "";
    }
  }

  const profile = await upsertProfile({
    Handle: normalized.authorHandle,
    Name: normalized.authorName,
    Platform: normalized.platform,
    Link:
      normalized.platform === "instagram"
        ? `https://www.instagram.com/${normalized.authorHandle.replace(/^@/, "")}/`
        : normalized.platform === "tiktok"
          ? `https://www.tiktok.com/@${normalized.authorHandle.replace(/^@/, "")}`
          : `https://x.com/${normalized.authorHandle.replace(/^@/, "")}`,
    Followers: normalized.authorFollowers,
    ...(avatar ? { Avatar: avatar } : {}),
    Verified: normalized.authorVerified,
    "Platform User ID": normalized.platformUserId,
  });

  const hasMedia = normalized.media.length > 0;
  const saveToR2 = input.saveToR2 !== false;
  let saveMode: "sync" | "async" | "none" = !saveToR2
    ? "none"
    : input.saveMode ??
      (normalized.media.length > 1 ? "async" : "sync");

  // Big single videos (often X) — don't block the HTTP request
  if (saveMode === "sync" && normalized.media.length === 1) {
    const { headCdnUrl } = await import("./r2.js");
    const head = await headCdnUrl(normalized.media[0]!.fileUrl);
    if ((head.contentLength ?? 0) > 25 * 1024 * 1024) {
      saveMode = "async";
    }
  }

  const post = await upsertPost({
    "Post ID": normalized.postId,
    Platform: normalized.platform,
    Author: normalized.authorHandle,
    Text: normalized.caption,
    Link: normalized.url,
    Likes: normalized.likes,
    Comments: normalized.comments,
    Shares: normalized.shares,
    Views: normalized.views,
    Saves: normalized.saves,
    Posted: normalized.postedAt,
    Scraped: new Date().toISOString(),
    "Media count": normalized.media.length,
    "Has media": hasMedia,
    Cover: normalized.cover,
    Profile: [profile.id],
    "Post scraper": "scrapecreators",
    Status: hasMedia ? (saveToR2 ? "Saving" : "Scraped") : "No media",
    "Old pipeline": hasMedia
      ? saveToR2
        ? "pending_media"
        : "cdn_ready"
      : "no_media",
    "Post type":
      normalized.media.length > 1 ? "carousel" : normalized.postType,
    "Duration (sec)": normalized.durationSec,
  });

  const mediaOut: ScrapePostResult["media"] = [];
  const mediaIds: string[] = [];

  for (const asset of normalized.media) {
    const media = await upsertMedia({
      "Media ID": asset.mediaId,
      Post: [post.id],
      Order: asset.order,
      Type: asset.type,
      "File link": asset.fileUrl,
      "Preview link": asset.previewUrl,
      Width: asset.width,
      Height: asset.height,
      "Duration ms": asset.durationMs,
      "File type": asset.fileType,
      "File scraper": "scrapecreators",
      ...saveStatusFields("pending"),
      "Old file status": "cdn_ready",
      Label: `${normalized.platform} slide ${asset.order}`,
    });
    mediaIds.push(media.id);

    mediaOut.push({
      id: media.id,
      mediaId: asset.mediaId,
      order: asset.order,
      type: asset.type,
      fileLink: asset.fileUrl,
      previewLink: asset.previewUrl,
      savedCopy: String(media.fields["Saved copy"] ?? "") || undefined,
      fileStatus: String(media.fields.saveStatus ?? "pending"),
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
    });
  }

  if (mediaIds.length) {
    // Posts.Files = 1→many Media (carousel-safe link)
    await updatePost(post.id, {
      Files: mediaIds,
      "Media count": mediaIds.length,
    });
  }

  const saveOne = async (
    m: (typeof mediaOut)[number],
    extra?: Record<string, unknown>,
  ) => {
    try {
      const saved = await saveMediaCdnToR2({
        mediaRecordId: m.id,
        postRecordId: post.id,
        fileUrl: m.fileLink,
        mediaType: m.type,
        force: Boolean(input.force),
      });
      m.save = { ...saved, ...extra };
      if (saved.ok) {
        m.savedCopy = saved.savedCopy;
        m.fileStatus = "saved";
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[scrape-post] save failed", m.id, message);
      try {
        await recordMediaSaveFailure({
          mediaRecordId: m.id,
          postRecordId: post.id,
          message,
        });
      } catch (markErr) {
        console.error("[scrape-post] failed to record save failure", markErr);
      }
      m.fileStatus = "failed";
      m.save = { ok: false, error: message, ...extra };
    }
  };

  let postStatus = hasMedia ? (saveToR2 ? "Saving" : "Scraped") : "No media";

  const result = (
    extra?: Pick<ScrapePostResult, "saved" | "reason">,
  ): ScrapePostResult => ({
    ok: true,
    ...extra,
    platform: normalized.platform,
    profile: {
      id: profile.id,
      handle: normalized.authorHandle,
      name: normalized.authorName,
      avatar: avatar || undefined,
    },
    post: {
      id: post.id,
      postId: normalized.postId,
      text: normalized.caption,
      link: normalized.url,
      status: postStatus,
      postType: normalized.postType,
      repostKind: normalized.repostKind,
      quotedHandle: normalized.quotedHandle,
      likes: normalized.likes,
      comments: normalized.comments,
      shares: normalized.shares,
      views: normalized.views,
      durationSec: normalized.durationSec,
      mediaCount: mediaIds.length,
    },
    media: mediaOut.sort((a, b) => a.order - b.order),
    saveMode,
    creditsCharged: normalized.creditsCharged,
    creditsRemaining: normalized.creditsRemaining,
    cached: normalized.cached,
  });

  if (saveMode === "async" && mediaOut.length) {
    const jobs = mediaOut.map((m) => ({
      mediaRecordId: m.id,
      postRecordId: post.id,
      fileUrl: m.fileLink,
      mediaType: m.type,
      force: Boolean(input.force),
    }));
    try {
      const batch = await queueMediaSaves(jobs);
      for (const m of mediaOut) {
        m.fileStatus = "pending";
        m.save = { queued: true, batch };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[scrape-post] Trigger.dev queue failed:", message);
      await updatePost(post.id, { Status: "Queue failed" });
      postStatus = "Queue failed";
      await invalidateLibrary();
      return result({ saved: false, reason: "queue_failed" });
    }
  } else if (saveMode === "sync" && mediaOut.length) {
    for (const m of mediaOut) {
      await saveOne(m);
    }
    const allSaved = mediaOut.every((m) => m.fileStatus === "saved");
    postStatus = allSaved ? "Saved" : "Partial";
    await updatePost(post.id, { Status: postStatus });
  }

  await invalidateLibrary();

  return result();
}
