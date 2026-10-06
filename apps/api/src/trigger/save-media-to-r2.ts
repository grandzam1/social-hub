import { task } from "@trigger.dev/sdk";
import { ensureDefaultDbProvider } from "../catalog/index.js";
import { refreshPostSaveStatus } from "../lib/post-status.js";
import {
  recordMediaSaveFailure,
  saveMediaCdnToR2,
  type SaveMediaInput,
} from "../lib/save-media.js";

/** Download the platform file, store it on R2, and write Saved copy. */
export const saveMediaToR2 = task({
  id: "save-media-to-r2",
  retry: { maxAttempts: 3 },
  maxDuration: 600,
  onFailure: async ({ payload, error }) => {
    const input = payload as SaveMediaInput;
    if (!input?.mediaRecordId) return;
    const message = error instanceof Error ? error.message : String(error);
    await recordMediaSaveFailure({
      mediaRecordId: input.mediaRecordId,
      postRecordId: input.postRecordId,
      message,
    });
  },
  run: async (payload: SaveMediaInput) => {
    ensureDefaultDbProvider();
    const postId = payload.postRecordId;
    try {
      return await saveMediaCdnToR2(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (payload.mediaRecordId) {
        await recordMediaSaveFailure({
          mediaRecordId: payload.mediaRecordId,
          postRecordId: payload.postRecordId,
          message,
        });
      }
      throw error;
    } finally {
      if (postId) await refreshPostSaveStatus(postId);
    }
  },
});
