import { listMedia, listPosts, type AirtableRecord } from "./airtable.js";

export type ScrapKind = "text" | "image" | "video";

export type ScrapItem = {
  id: string;
  kind: ScrapKind;
  text?: string;
  previewUrl?: string;
  fileUrl?: string;
  user: string;
  platform?: string;
  postLink?: string;
  postRecordId?: string;
  mediaRecordId?: string;
  savedAt: string;
  fileStatus?: string;
  order?: number;
};

export type ScrapsResponse = {
  ok: true;
  items: ScrapItem[];
  users: string[];
  counts: { all: number; text: number; image: number; video: number };
};

function asStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function mediaKind(type: unknown): ScrapKind | null {
  const t = String(type || "").toLowerCase();
  if (t === "video" || t === "gif") return "video";
  if (t === "image" || t === "photo") return "image";
  return null;
}

function preferUrl(...urls: Array<string | undefined>) {
  return urls.find((u) => u && /^https?:\/\//i.test(u));
}

/**
 * Build a flat library of saved scraps from Posts + Media.
 * Media rows become image/video cards; posts without media become text cards.
 */
export async function listScraps(filters?: {
  type?: string;
  user?: string;
  q?: string;
}): Promise<ScrapsResponse> {
  const [postsRes, mediaRes] = await Promise.all([
    listPosts(80),
    listMedia(100),
  ]);

  const postsById = new Map<string, AirtableRecord>();
  for (const p of postsRes.records) postsById.set(p.id, p);

  const postsWithMedia = new Set<string>();
  const items: ScrapItem[] = [];

  for (const m of mediaRes.records) {
    const f = m.fields;
    const kind = mediaKind(f.Type);
    if (!kind) continue;

    const postIds = Array.isArray(f.Post) ? (f.Post as string[]) : [];
    const post = postIds[0] ? postsById.get(postIds[0]) : undefined;
    if (postIds[0]) postsWithMedia.add(postIds[0]);

    const user =
      asStr(post?.fields.Author) ||
      asStr(f.Label)?.split(" ")[0] ||
      "unknown";
    const previewUrl = preferUrl(
      asStr(f["Saved copy"]),
      asStr(f["Preview link"]),
      asStr(f["File link"]),
    );
    const fileUrl = preferUrl(asStr(f["Saved copy"]), asStr(f["File link"]));

    items.push({
      id: `media:${m.id}`,
      kind,
      text: asStr(post?.fields.Text),
      previewUrl,
      fileUrl,
      user,
      platform: asStr(post?.fields.Platform),
      postLink: asStr(post?.fields.Link),
      postRecordId: post?.id,
      mediaRecordId: m.id,
      savedAt:
        asStr(post?.fields.Scraped) ||
        m.createdTime ||
        asStr(post?.createdTime) ||
        new Date().toISOString(),
      fileStatus: asStr(f["File status"]),
      order: typeof f.Order === "number" ? f.Order : undefined,
    });
  }

  for (const p of postsRes.records) {
    if (postsWithMedia.has(p.id)) continue;
    const text = asStr(p.fields.Text);
    if (!text) continue;
    items.push({
      id: `text:${p.id}`,
      kind: "text",
      text,
      user: asStr(p.fields.Author) || "unknown",
      platform: asStr(p.fields.Platform),
      postLink: asStr(p.fields.Link),
      postRecordId: p.id,
      savedAt:
        asStr(p.fields.Scraped) || p.createdTime || new Date().toISOString(),
    });
  }

  items.sort(
    (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
  );

  const type = (filters?.type || "all").toLowerCase();
  const user = (filters?.user || "").trim().toLowerCase();
  const q = (filters?.q || "").trim().toLowerCase();

  let filtered = items;
  if (type === "text" || type === "image" || type === "video") {
    filtered = filtered.filter((i) => i.kind === type);
  }
  if (user && user !== "all") {
    filtered = filtered.filter((i) => i.user.toLowerCase() === user);
  }
  if (q) {
    filtered = filtered.filter(
      (i) =>
        i.text?.toLowerCase().includes(q) ||
        i.user.toLowerCase().includes(q) ||
        i.platform?.toLowerCase().includes(q) ||
        i.postLink?.toLowerCase().includes(q),
    );
  }

  const users = [...new Set(items.map((i) => i.user))].sort((a, b) =>
    a.localeCompare(b),
  );

  return {
    ok: true,
    items: filtered,
    users,
    counts: {
      all: items.length,
      text: items.filter((i) => i.kind === "text").length,
      image: items.filter((i) => i.kind === "image").length,
      video: items.filter((i) => i.kind === "video").length,
    },
  };
}
