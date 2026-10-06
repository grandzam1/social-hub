import type { AirtableRecord, Catalog, CatalogPage } from "../types.js";

function clone(fields: Record<string, unknown>): Record<string, unknown> {
  return { ...fields };
}

export function createMemoryCatalog(): Catalog {
  const profiles = new Map<string, AirtableRecord>();
  const posts = new Map<string, AirtableRecord>();
  const media = new Map<string, AirtableRecord>();
  let seq = 0;

  function nextId(prefix: string): string {
    seq += 1;
    return `${prefix}${seq}`;
  }

  function must(
    table: Map<string, AirtableRecord>,
    id: string,
    label: string,
  ): AirtableRecord {
    const row = table.get(id);
    if (!row) throw new Error(`memory catalog: ${label} ${id} not found`);
    return row;
  }

  function page(
    rows: AirtableRecord[],
    pageSize = 50,
  ): CatalogPage {
    return { records: rows.slice(0, pageSize) };
  }

  function variants(handle: string): string[] {
    const bare = handle.replace(/^@/, "").trim();
    return [...new Set([handle.trim(), bare, `@${bare}`].filter(Boolean))];
  }

  return {
    async upsertProfile(fields) {
      const handle = String(fields.Handle ?? "");
      const platform = String(fields.Platform ?? "");
      const existing =
        handle && platform
          ? [...profiles.values()].find(
              (row) =>
                row.fields.Handle === handle && row.fields.Platform === platform,
            )
          : undefined;
      if (existing) {
        existing.fields = { ...existing.fields, ...clone(fields) };
        return existing;
      }
      const row: AirtableRecord = {
        id: nextId("recProfile"),
        fields: clone(fields),
      };
      profiles.set(row.id, row);
      return row;
    },

    async upsertPost(fields) {
      const postId = String(fields["Post ID"] ?? "");
      const existing = postId
        ? [...posts.values()].find((row) => row.fields["Post ID"] === postId)
        : undefined;
      if (existing) {
        existing.fields = { ...existing.fields, ...clone(fields) };
        return existing;
      }
      const row: AirtableRecord = {
        id: nextId("recPost"),
        fields: clone(fields),
      };
      posts.set(row.id, row);
      return row;
    },

    async upsertMedia(fields) {
      const mediaId = String(fields["Media ID"] ?? "");
      const existing = mediaId
        ? [...media.values()].find((row) => row.fields["Media ID"] === mediaId)
        : undefined;
      if (existing) {
        const merged = { ...clone(fields) };
        if (!merged["Saved copy"] && existing.fields["Saved copy"]) {
          delete merged["Saved copy"];
        }
        existing.fields = { ...existing.fields, ...merged };
        return existing;
      }
      const row: AirtableRecord = {
        id: nextId("recMedia"),
        fields: clone(fields),
      };
      media.set(row.id, row);
      return row;
    },

    async getPost(recordId) {
      return must(posts, recordId, "post");
    },

    async getMedia(recordId) {
      return must(media, recordId, "media");
    },

    async listMediaForPost(postRecordId) {
      const post = must(posts, postRecordId, "post");
      const linked = Array.isArray(post.fields.Files)
        ? (post.fields.Files as string[]).filter(Boolean)
        : [];
      const rows = [...media.values()].filter((row) => {
        if (linked.length) return linked.includes(row.id);
        const postLink = row.fields.Post;
        return Array.isArray(postLink) && postLink.includes(postRecordId);
      });
      return rows.sort(
        (a, b) => Number(a.fields.Order ?? 0) - Number(b.fields.Order ?? 0),
      );
    },

    async updatePost(recordId, fields) {
      const row = must(posts, recordId, "post");
      row.fields = { ...row.fields, ...clone(fields) };
      return row;
    },

    async updateMedia(recordId, fields) {
      const row = must(media, recordId, "media");
      row.fields = { ...row.fields, ...clone(fields) };
      return row;
    },

    async listPosts(pageSize = 50) {
      const rows = [...posts.values()].sort((a, b) =>
        String(b.fields.Scraped ?? "").localeCompare(String(a.fields.Scraped ?? "")),
      );
      return page(rows, pageSize);
    },

    async listMedia(pageSize = 100) {
      return page([...media.values()], Math.min(pageSize, 100));
    },

    async listProfiles(pageSize = 100) {
      return page([...profiles.values()], Math.min(pageSize, 100));
    },

    async findProfile(handle, platform) {
      for (const variant of variants(handle)) {
        const found = [...profiles.values()].find(
          (row) =>
            row.fields.Handle === variant && row.fields.Platform === platform,
        );
        if (found) return found;
      }
      return null;
    },

    async findPostLink(handle, platform) {
      for (const variant of variants(handle)) {
        const found = [...posts.values()].find(
          (row) =>
            row.fields.Author === variant && row.fields.Platform === platform,
        );
        const link = found?.fields.Link;
        if (typeof link === "string" && link.trim()) return link.trim();
      }
      return undefined;
    },

    async updateProfile(recordId, fields) {
      const row = must(profiles, recordId, "profile");
      row.fields = { ...row.fields, ...clone(fields) };
      return row;
    },
  };
}

export const memoryCatalog: Catalog = createMemoryCatalog();
