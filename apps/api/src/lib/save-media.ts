import { getMedia, updateMedia } from "./airtable.js";
import { downloadCdnUrl, guessExt, uploadToR2 } from "./r2.js";
import {
  refreshPostSaveStatus,
  resolvePostIdFromMedia,
} from "./post-status.js";

export type SaveMediaInput = {
  mediaRecordId: string;
  postRecordId?: string;
  fileUrl?: string;
  objectKey?: string;
  mediaType?: string;
  force?: boolean;
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
  const { mediaRecordId, postRecordId, fileUrl, objectKey, mediaType, force } =
    input;
  if (!mediaRecordId) throw new Error("mediaRecordId required");

  const media = await getMedia(mediaRecordId);
  const existingSaved = String(media.fields["Saved copy"] ?? "");
  const postId = await resolvePostIdFromMedia(mediaRecordId, postRecordId);

  if (existingSaved && !force) {
    const postStatus = postId
      ? await refreshPostSaveStatus(postId, { saving: true })
      : undefined;
    return {
      ok: true,
      skipped: true,
      reason: "already-saved",
      savedCopy: existingSaved,
      fileLink: media.fields["File link"],
      mediaRecordId,
      postStatus,
    };
  }

  const cdnUrl = String(fileUrl || media.fields["File link"] || "");
  if (!cdnUrl) throw new Error(`No CDN File link on ${mediaRecordId}`);

  if (postId) {
    await refreshPostSaveStatus(postId, { saving: true });
  }

  const { buffer, contentType } = await downloadCdnUrl(cdnUrl);
  const ext = guessExt(contentType, mediaType);
  const key = objectKey || `social-hub/${mediaRecordId}/${Date.now()}.${ext}`;
  const uploaded = await uploadToR2({
    key,
    body: buffer,
    contentType,
  });

  await updateMedia(mediaRecordId, {
    "Saved copy": uploaded.publicUrl,
    "File status": "Saved copy ready",
    "Old file status": "stored",
  });

  const postStatus = postId
    ? await refreshPostSaveStatus(postId, { saving: true })
    : undefined;

  return {
    ok: true,
    mediaRecordId,
    fileLink: cdnUrl,
    savedCopy: uploaded.publicUrl,
    bytes: uploaded.bytes,
    key: uploaded.key,
    postStatus,
  };
}
