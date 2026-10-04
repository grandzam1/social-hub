export type AirtableRecord = {
  id: string;
  fields: Record<string, unknown>;
  createdTime?: string;
};

export type CatalogPage = {
  records: AirtableRecord[];
  offset?: string;
};

/** Functions the app already calls on the Airtable client. */
export interface Catalog {
  upsertProfile(fields: Record<string, unknown>): Promise<AirtableRecord>;
  upsertPost(fields: Record<string, unknown>): Promise<AirtableRecord>;
  upsertMedia(fields: Record<string, unknown>): Promise<AirtableRecord>;
  getPost(recordId: string): Promise<AirtableRecord>;
  getMedia(recordId: string): Promise<AirtableRecord>;
  listMediaForPost(postRecordId: string): Promise<AirtableRecord[]>;
  updatePost(
    recordId: string,
    fields: Record<string, unknown>,
  ): Promise<AirtableRecord>;
  updateMedia(
    recordId: string,
    fields: Record<string, unknown>,
  ): Promise<AirtableRecord>;
  listPosts(pageSize?: number): Promise<CatalogPage>;
  listMedia(pageSize?: number): Promise<CatalogPage>;
  listProfiles(pageSize?: number): Promise<CatalogPage>;
  findProfile(handle: string, platform: string): Promise<AirtableRecord | null>;
  findPostLink(handle: string, platform: string): Promise<string | undefined>;
  updateProfile(
    recordId: string,
    fields: Record<string, unknown>,
  ): Promise<AirtableRecord>;
}
