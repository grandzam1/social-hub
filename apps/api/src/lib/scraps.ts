import {
  listMedia,
  listPosts,
  listProfiles,
  type AirtableRecord,
} from "./airtable.js";

export type ScrapKind = "text" | "image" | "video";

export type ScrapItem = {
  id: string;
  kind: ScrapKind;
  text?: string;
  previewUrl?: string;
  fileUrl?: string;
  user: string;
  avatarUrl?: string;
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

function isLikelyVideoUrl(url?: string): boolean {
  if (!url) return false;
  return /\.(mp4|mov|webm|m4v|m3u8)(\?|#|$)/i.test(url);
}

function isLikelyImageUrl(url?: string): boolean {
  if (!url || isLikelyVideoUrl(url)) return false;
  if (/\.(jpe?g|png|gif|webp|avif|bmp)(\?|#|$)/i.test(url)) return true;
  // CDN thumbs without extension (twimg, etc.) — treat as image unless clearly video
  return true;
}

function profileAvatar(profile?: AirtableRecord): string | undefined {
  if (!profile) return undefined;
  const f = profile.fields;
  return preferUrl(
    asStr(f.Avatar),
    asStr(f.avatar),
    asStr(f["Profile image"]),
    asStr(f.Photo),
  );
}

function normalizeHandle(h: string): string {
  return h.replace(/^@/, "").trim().toLowerCase();
}

/**
 * Build a flat library of saved scraps from Posts + Media + Profiles.
 */
export async function listScraps(filters?: {
  type?: string;
  user?: string;
  q?: string;
}): Promise<ScrapsResponse> {
  const [postsRes, mediaRes, profilesRes] = await Promise.all([
    listPosts(80),
    listMedia(100),
    listProfiles(100).catch(() => ({ records: [] as AirtableRecord[] })),
  ]);

  const postsById = new Map<string, AirtableRecord>();
  for (const p of postsRes.records) postsById.set(p.id, p);

  const profilesById = new Map<string, AirtableRecord>();
  const profilesByHandle = new Map<string, AirtableRecord>();
  for (const pr of profilesRes.records) {
    profilesById.set(pr.id, pr);
    const handle = asStr(pr.fields.Handle);
    const platform = asStr(pr.fields.Platform) || "";
    if (handle) {
      profilesByHandle.set(`${platform.toLowerCase()}:${normalizeHandle(handle)}`, pr);
      profilesByHandle.set(normalizeHandle(handle), pr);
    }
  }

  function resolveAvatar(post?: AirtableRecord, user?: string, platform?: string) {
    const linked = Array.isArray(post?.fields.Profile)
      ? (post!.fields.Profile as string[])
      : [];
    if (linked[0] && profilesById.has(linked[0])) {
      return profileAvatar(profilesById.get(linked[0]));
    }
    if (user) {
      const key = `${(platform || "").toLowerCase()}:${normalizeHandle(user)}`;
      return (
        profileAvatar(profilesByHandle.get(key)) ||
        profileAvatar(profilesByHandle.get(normalizeHandle(user)))
      );
    }
    return undefined;
  }

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
    const platform = asStr(post?.fields.Platform);
    const saved = asStr(f["Saved copy"]);
    const preview = asStr(f["Preview link"]);
    const fileLink = asStr(f["File link"]);
    const fileUrl = preferUrl(saved, fileLink);
    // Videos need an image poster — never reuse the mp4 as previewUrl.
    const previewUrl =
      kind === "video"
        ? preferUrl(
            isLikelyImageUrl(preview) ? preview : undefined,
            isLikelyImageUrl(fileLink) ? fileLink : undefined,
            isLikelyImageUrl(saved) ? saved : undefined,
          )
        : preferUrl(saved, preview, fileLink);

    items.push({
      id: `media:${m.id}`,
      kind,
      text: asStr(post?.fields.Text),
      previewUrl,
      fileUrl,
      user,
      avatarUrl: resolveAvatar(post, user, platform),
      platform,
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
    const user = asStr(p.fields.Author) || "unknown";
    const platform = asStr(p.fields.Platform);
    items.push({
      id: `text:${p.id}`,
      kind: "text",
      text,
      user,
      avatarUrl: resolveAvatar(p, user, platform),
      platform,
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
    const needle = normalizeHandle(user);
    filtered = filtered.filter(
      (i) => normalizeHandle(i.user) === needle,
    );
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

  const users = [
    ...new Set(items.map((i) => normalizeHandle(i.user)).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));

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
