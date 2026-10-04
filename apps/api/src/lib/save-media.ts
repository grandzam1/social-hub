import { connectionsEnv } from "../connections/runtime.js";
import { getCatalog, type AirtableRecord } from "../catalog/index.js";
import { getScraper } from "../platforms/index.js";
import { transferCdnToR2, type DetectedMedia } from "./r2.js";
import { readSaveStatus, saveStatusFields } from "./save-status.js";
import { invalidateLibrary } from "./library-cache.js";

async function catalog() {
  return getCatalog(connectionsEnv());
}

async function getMedia(recordId: string) {
  return (await catalog()).getMedia(recordId);
}

async function getPost(recordId: string) {
  return (await catalog()).getPost(recordId);
}

async function listMediaForPost(postRecordId: string) {
  return (await catalog()).listMediaForPost(postRecordId);
}

async function updateMedia(recordId: string, fields: Record<string, unknown>) {
  return (await catalog()).updateMedia(recordId, fields);
}

async function updatePost(recordId: string, fields: Record<string, unknown>) {
  return (await catalog()).updatePost(recordId, fields);
}

export type SaveMediaInput = {
  mediaRecordId: string;
  postRecordId?: string;
  fileUrl?: string;
  objectKey?: string;
  mediaType?: string;
  force?: boolean;
  /** Update only the media row. Leave the post record untouched. */
  mediaOnly?: boolean;
};

export type SaveMediaResult =
  | {
      ok: true;
      skipped?: false;
      mediaRecordId: string;
      fileLink: string;
      savedCopy: string;
      bytes: number;
      key: string;
      postStatus?: { status: string; total: number; saved: number };
    }
  | {
      ok: true;
      skipped: true;
      reason: string;
      savedCopy: string;
      fileLink: unknown;
      mediaRecordId: string;
      postStatus?: { status: string; total: number; saved: number };
    };

/**
 * Standalone pipeline: CDN File link → R2 → Airtable Saved copy.
 * Keeps original CDN on File link.
 * Parent Posts.Status becomes Saved only when ALL linked Media are ready.
 */
export async function saveMediaCdnToR2(
  input: SaveMediaInput,
): Promise<SaveMediaResult> {
  const {
    mediaRecordId,
    fileUrl,
    objectKey,
    mediaType,
    force,
    mediaOnly,
  } = input;
  if (!mediaRecordId) throw new Error("mediaRecordId required");

  const media = await getMedia(mediaRecordId);
  const existingSaved = String(media.fields["Saved copy"] ?? "");

  if (existingSaved && !force && readSaveStatus(media.fields) === "saved") {
    return {
      ok: true,
      skipped: true,
      reason: "already-saved",
      savedCopy: existingSaved,
      fileLink: media.fields["File link"],
      mediaRecordId,
    };
  }

  let cdnUrl = String(fileUrl || media.fields["File link"] || "");
  const storedUrl = cdnUrl;

  if (mediaOnly) {
    const fresh = await freshFileUrlForMedia(media);
    if (fresh) cdnUrl = fresh;
  }
  if (!cdnUrl) throw new Error(`No CDN File link on ${mediaRecordId}`);

  let libraryChanged = false;
  let uploaded;
  try {
    try {
      uploaded = await transferCdnToR2({
        url: cdnUrl,
        objectKey,
        mediaRecordId,
        mediaType: mediaType || String(media.fields.Type ?? ""),
      });
    } catch (err) {
      if (!mediaOnly || !isDeadCdn(err) || cdnUrl !== storedUrl) throw err;
      const fresh = await freshFileUrlForMedia(media);
      if (!fresh || fresh === cdnUrl) throw err;
      cdnUrl = fresh;
      uploaded = await transferCdnToR2({
        url: fresh,
        objectKey,
        mediaRecordId,
        mediaType: mediaType || String(media.fields.Type ?? ""),
      });
    }

    await updateMedia(mediaRecordId, {
      "Saved copy": uploaded.publicUrl,
      ...(cdnUrl !== storedUrl ? { "File link": cdnUrl } : {}),
      ...kindFields(uploaded),
      ...saveStatusFields("saved"),
      "Old file status": "stored",
    });
    libraryChanged = true;
  } finally {
    if (libraryChanged) await invalidateLibrary();
  }

  return {
    ok: true,
    mediaRecordId,
    fileLink: cdnUrl,
    savedCopy: uploaded.publicUrl,
    bytes: uploaded.bytes,
    key: uploaded.key,
  };
}

function kindFields(uploaded: { kind: DetectedMedia["kind"]; fileType: string }) {
  const type =
    uploaded.kind === "gif" ? "gif" : uploaded.kind === "video" ? "video" : "image";
  return { Type: type, "File type": uploaded.fileType };
}

function canonicalPostUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  parsed.search = "";
  parsed.hash = "";
  if (parsed.hostname.includes("instagram.com")) {
    const match = parsed.pathname.match(/\/(p|reel|tv)\/([^/]+)/);
    if (match) return `https://www.instagram.com/${match[1]}/${match[2]}/`;
  }
  return parsed.toString();
}

function isDeadCdn(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /CDN download failed (401|403|404|410|400)\b/.test(message);
}

async function scrapeFreshMedia(url: string) {
  const scraper = await getScraper(connectionsEnv());
  const normalized = await scraper.fetchPost(url);
  return normalized.media;
}

function fileUrlAtOrder(
  media: Array<{ order: number; fileUrl: string }>,
  order: number,
): string {
  const match =
    media.find((item) => item.order === order) ??
    media[order] ??
    (media.length === 1 ? media[0] : undefined);
  return match?.fileUrl?.trim() || "";
}

/**
 * Read a fresh platform file URL for this media row.
 * Does not write the post, profile, or any other media row.
 */
async function freshFileUrlForMedia(
  media: AirtableRecord,
): Promise<string | undefined> {
  const linked = media.fields.Post;
  const postId = Array.isArray(linked) ? String(linked[0] ?? "") : "";
  if (!postId) return undefined;
  const post = await getPost(postId);
  const url = canonicalPostUrl(String(post.fields.Link ?? "").trim());
  if (!url) return undefined;
  const fresh = await scrapeFreshMedia(url);
  const order = Number(media.fields.Order ?? 0);
  const fileUrl = fileUrlAtOrder(fresh, order);
  if (!fileUrl) {
    throw new Error(
      `No file found for slide ${order + 1} on the original post`,
    );
  }
  return fileUrl;
}

/**
 * Save every unsaved slide on one post. Already-saved slides are left as they are.
 * The post status is written once, after the slides.
 */
export async function saveUnsavedMediaForPost(postRecordId: string): Promise<{
  saved: Array<{ mediaRecordId: string; savedCopy: string }>;
  failed: Array<{ mediaRecordId: string; error: string }>;
  skipped: number;
}> {
  const post = await getPost(postRecordId);
  const rows = await listMediaForPost(postRecordId);
  const pending = rows.filter(
    (row) => readSaveStatus(row.fields) !== "saved",
  );
  const skipped = rows.length - pending.length;
  if (!pending.length) {
    if (rows.length) await updatePost(postRecordId, { Status: "Saved" });
    return { saved: [], failed: [], skipped };
  }

  const link = canonicalPostUrl(String(post.fields.Link ?? "").trim());
  let fresh: Array<{ order: number; fileUrl: string }> = [];
  if (link) {
    try {
      fresh = await scrapeFreshMedia(link);
    } catch {
      fresh = [];
    }
  }

  const saved: Array<{ mediaRecordId: string; savedCopy: string }> = [];
  const failed: Array<{ mediaRecordId: string; error: string }> = [];
  for (const row of pending) {
    const order = Number(row.fields.Order ?? 0);
    const stored = String(row.fields["File link"] ?? "");
    const freshUrl = fileUrlAtOrder(fresh, order);
    const url = freshUrl || stored;
    if (!url) {
      failed.push({
        mediaRecordId: row.id,
        error: `No file found for slide ${order + 1}`,
      });
      continue;
    }
    try {
      const uploaded = await transferCdnToR2({
        url,
        mediaRecordId: row.id,
        mediaType: String(row.fields.Type ?? ""),
      });
      await updateMedia(row.id, {
        "Saved copy": uploaded.publicUrl,
        ...(url !== stored ? { "File link": url } : {}),
        ...kindFields(uploaded),
        ...saveStatusFields("saved"),
        "Old file status": "stored",
      });
      saved.push({
        mediaRecordId: row.id,
        savedCopy: uploaded.publicUrl,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({
        mediaRecordId: row.id,
        error: message.replace(/\s+/g, " ").trim().slice(0, 180),
      });
    }
  }

  if (saved.length) await invalidateLibrary();

  const allSaved = failed.length === 0 && saved.length + skipped === rows.length;
  await updatePost(postRecordId, {
    Status: allSaved ? "Saved" : "Partial",
  });

  return { saved, failed, skipped };
}

/** Marks one media row failed. The caller writes the parent post status. */
export async function recordMediaSaveFailure(input: {
  mediaRecordId: string;
  postRecordId?: string;
  message: string;
}): Promise<void> {
  const message = input.message.replace(/\s+/g, " ").trim().slice(0, 180);
  await updateMedia(input.mediaRecordId, {
    ...saveStatusFields("failed"),
    "Old file status": message || "save failed",
  });
  await invalidateLibrary();
}
