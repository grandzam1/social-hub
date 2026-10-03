import {
  getMedia,
  listMediaForPost,
  updatePost,
  type AirtableRecord,
} from "./airtable.js";
import { readSaveStatus } from "./save-status.js";

export type PostSaveStatus = "Scraped" | "Saving" | "Saved" | "No media" | "Failed";

function isSavedCopyReady(media: AirtableRecord): boolean {
  return readSaveStatus(media.fields) === "saved";
}

function isSaveFailed(media: AirtableRecord): boolean {
  return readSaveStatus(media.fields) === "failed";
}

function isSavePending(media: AirtableRecord): boolean {
  return readSaveStatus(media.fields) === "pending";
}

/**
 * Parent Posts.Status reflects ALL child Media rows:
 * - No media → No media
 * - All saveStatus saved → Saved
 * - Any failed, and no save currently running → Failed
 * - A save is running, or some slides are already saved → Saving
 * - Otherwise Scraped
 */
export async function refreshPostSaveStatus(
  postRecordId: string,
  options?: { saving?: boolean },
): Promise<{ status: PostSaveStatus; total: number; saved: number }> {
  const items = await listMediaForPost(postRecordId);
  const total = items.length;
  if (!total) {
    await updatePost(postRecordId, {
      Status: "No media",
      "Media count": 0,
      "Old pipeline": "no_media",
    });
    return { status: "No media", total: 0, saved: 0 };
  }

  const saved = items.filter(isSavedCopyReady).length;
  const failed = items.filter(isSaveFailed).length;
  const pending = items.filter(isSavePending).length;
  let status: PostSaveStatus;
  let pipeline: string;

  if (saved === total) {
    status = "Saved";
    pipeline = "stored";
  } else if (options?.saving && pending > 0) {
    status = "Saving";
    pipeline = "pending_media";
  } else if (failed > 0) {
    status = "Failed";
    pipeline = "save_failed";
  } else if (saved > 0) {
    status = "Saving";
    pipeline = "pending_media";
  } else {
    status = "Scraped";
    pipeline = "cdn_ready";
  }

  await updatePost(postRecordId, {
    Status: status,
    "Media count": total,
    "Old pipeline": pipeline,
  });

  return { status, total, saved };
}

/** Resolve post id from a media row if caller omitted it. */
export async function resolvePostIdFromMedia(
  mediaRecordId: string,
  explicit?: string,
): Promise<string | undefined> {
  if (explicit) return explicit;
  const media = await getMedia(mediaRecordId);
  const linked = media.fields.Post;
  if (Array.isArray(linked) && linked[0]) return String(linked[0]);
  return undefined;
}
