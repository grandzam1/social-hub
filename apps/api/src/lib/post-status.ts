import {
  getMedia,
  listMediaForPost,
  updatePost,
  type AirtableRecord,
} from "./airtable.js";

export type PostSaveStatus = "Scraped" | "Saving" | "Saved" | "No media" | "Failed";

function isSavedCopyReady(media: AirtableRecord): boolean {
  const status = String(media.fields["File status"] ?? "");
  const saved = String(media.fields["Saved copy"] ?? "");
  return Boolean(saved) || status === "Saved copy ready";
}

/**
 * Parent Posts.Status reflects ALL child Media rows:
 * - No media → No media
 * - All Saved copy ready → Saved
 * - Any still pending → Saving (if save started) or Scraped
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
  let status: PostSaveStatus;
  let pipeline: string;

  if (saved === total) {
    status = "Saved";
    pipeline = "stored";
  } else if (options?.saving || saved > 0) {
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
