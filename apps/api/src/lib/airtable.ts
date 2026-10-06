/**
 * Kept for apps/api/scripts/reconcile-media-kind.ts, which still calls listRecords.
 * App code uses getCatalog() from ../catalog/index.ts.
 */
export {
  listRecords,
  listPosts,
  listMedia,
  listProfiles,
  getMedia,
  updateMedia,
  updatePost,
  getPost,
  listMediaForPost,
  findPostLink,
  findProfile,
  updateProfile,
  upsertProfile,
  upsertPost,
  upsertMedia,
  type AirtableRecord,
} from "../catalog/providers/airtable.js";
