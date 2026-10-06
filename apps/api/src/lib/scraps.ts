import { connectionsEnv } from "../connections/runtime.js";
import { getCatalog, type AirtableRecord } from "../catalog/index.js";
import { readSaveStatus, type SaveStatus } from "./save-status.js";
import { detectMediaKind, isHostedMediaUrl, type DetectedMedia } from "./r2.js";
import { readLibrary, writeLibrary } from "./library-cache.js";

async function listPosts(pageSize?: number) {
  return (await getCatalog(connectionsEnv())).listPosts(pageSize);
}

async function listMedia(pageSize?: number) {
  return (await getCatalog(connectionsEnv())).listMedia(pageSize);
}

async function listProfiles(pageSize?: number) {
  return (await getCatalog(connectionsEnv())).listProfiles(pageSize);
}

export type ScrapKind = "text" | "image" | "video";

/** Images preview themselves. Videos preview only a poster we host. */
export function libraryPreviewUrl(
  kind: ScrapKind,
  savedCopy: string | undefined,
  savedPoster: string | undefined,
): string | undefined {
  return kind === "image" ? savedCopy : savedPoster;
}

export type ScrapItem = {
  id: string;
  kind: ScrapKind;
  text?: string;
  /** R2 URL when saveStatus is saved. Never a platform CDN link. */
  previewUrl?: string;
  fileUrl?: string;
  savedCopy?: string;
  saveStatus?: SaveStatus;
  user: string;
  avatarUrl?: string;
  platform?: string;
  postLink?: string;
  postRecordId?: string;
  mediaRecordId?: string;
  savedAt: string;
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

function scrapKind(detected: DetectedMedia): ScrapKind {
  return detected.kind === "image" ? "image" : "video";
}

/** Saved file, then File type, then the Type label. */
function mediaKind(fields: Record<string, unknown>): ScrapKind | null {
  const saved = asStr(fields["Saved copy"]);
  const fileType = asStr(fields["File type"]);
  const claimed = asStr(fields.Type);
  const detected =
    (saved ? detectMediaKind({ url: saved }) : null) ||
    (fileType ? detectMediaKind({ contentType: fileType }) : null) ||
    (claimed ? detectMediaKind({ claimedType: claimed }) : null);
  return detected ? scrapKind(detected) : null;
}

function preferUrl(...urls: Array<string | undefined>) {
  return urls.find((u) => u && /^https?:\/\//i.test(u));
}

async function profileAvatar(profile?: AirtableRecord): Promise<string | undefined> {
  if (!profile) return undefined;
  const f = profile.fields;
  const raw = preferUrl(
    asStr(f.Avatar),
    asStr(f.avatar),
    asStr(f["Profile image"]),
    asStr(f.Photo),
  );
  if (raw && (await isHostedMediaUrl(raw))) return raw;
  const handle = asStr(f.Handle);
  const platform = asStr(f.Platform);
  if (!raw || !handle || !platform) return undefined;
  const qs = new URLSearchParams({ platform, handle });
  return `/api/avatar?${qs}`;
}

function normalizeHandle(h: string): string {
  return h.replace(/^@/, "").trim().toLowerCase();
}

async function buildJoinedItems(): Promise<{
  items: ScrapItem[];
  cacheable: boolean;
}> {
  let profilesFailed = false;
  const [postsRes, mediaRes, profilesRes] = await Promise.all([
    listPosts(80),
    listMedia(100),
    listProfiles(100).catch(() => {
      profilesFailed = true;
      return { records: [] as AirtableRecord[] };
    }),
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

  async function resolveAvatar(post?: AirtableRecord, user?: string, platform?: string) {
    const linked = Array.isArray(post?.fields.Profile)
      ? (post!.fields.Profile as string[])
      : [];
    if (linked[0] && profilesById.has(linked[0])) {
      return await profileAvatar(profilesById.get(linked[0]));
    }
    if (user) {
      const key = `${(platform || "").toLowerCase()}:${normalizeHandle(user)}`;
      return (
        (await profileAvatar(profilesByHandle.get(key))) ||
        (await profileAvatar(profilesByHandle.get(normalizeHandle(user))))
      );
    }
    return undefined;
  }

  const postsWithMedia = new Set<string>();
  const items: ScrapItem[] = [];

  for (const m of mediaRes.records) {
    const f = m.fields;
    const postIds = Array.isArray(f.Post) ? (f.Post as string[]) : [];
    if (!postIds[0]) continue;
    const kind = mediaKind(f);
    if (!kind) continue;

    const post = postIds[0] ? postsById.get(postIds[0]) : undefined;
    if (postIds[0]) postsWithMedia.add(postIds[0]);

    const user =
      asStr(post?.fields.Author) ||
      asStr(f.Label)?.split(" ")[0] ||
      "unknown";
    const platform = asStr(post?.fields.Platform);
    const saveStatus = readSaveStatus(f);
    const savedCopy =
      saveStatus === "saved" ? asStr(f["Saved copy"]) : undefined;
    const savedPoster = asStr(f["Saved poster"]);

    items.push({
      id: `media:${m.id}`,
      kind,
      text: asStr(post?.fields.Text),
      previewUrl: libraryPreviewUrl(kind, savedCopy, savedPoster),
      fileUrl: savedCopy,
      savedCopy,
      saveStatus,
      user,
      avatarUrl: await resolveAvatar(post, user, platform),
      platform,
      postLink: asStr(post?.fields.Link),
      postRecordId: post?.id,
      mediaRecordId: m.id,
      savedAt:
        asStr(post?.fields.Scraped) ||
        m.createdTime ||
        asStr(post?.createdTime) ||
        new Date().toISOString(),
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
      avatarUrl: await resolveAvatar(p, user, platform),
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

  return { items, cacheable: !profilesFailed };
}

async function loadJoinedItems(): Promise<ScrapItem[]> {
  const cached = await readLibrary<ScrapItem[]>();
  if (Array.isArray(cached)) return cached;

  const built = await buildJoinedItems();
  if (built.cacheable) await writeLibrary(built.items);
  return built.items;
}

/**
 * Build a flat library of saved scraps from Posts + Media + Profiles.
 * The KV snapshot is the unfiltered join. type, user, and q still filter here.
 */
export async function listScraps(filters?: {
  type?: string;
  user?: string;
  q?: string;
}): Promise<ScrapsResponse> {
  const items = await loadJoinedItems();

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
