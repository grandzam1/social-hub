import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type Platform = "x" | "instagram" | "tiktok";
export type FeedFilter = "media" | "original" | "all";

export type BatchPost = {
  id: string;
  url?: string;
  handle?: string;
  caption?: string;
  postedAt?: string;
  mediaType?: string;
  mediaCount?: number;
  likes?: number;
  views?: number;
  width?: number;
  height?: number;
  thumbnail?: string;
  previewUrl?: string;
  repostKind?: string;
  quotedHandle?: string;
};

type BatchState = {
  platform: Platform;
  handle: string;
  filter: FeedFilter;
  posts: BatchPost[];
  note: string | null;
  fetchedAt: number | null;
  selectedIds: string[];
  recentHandles: { platform: Platform; handle: string }[];
  statusMessage: string | null;
  setPlatform: (platform: Platform) => void;
  setHandle: (handle: string) => void;
  setFilter: (filter: FeedFilter) => void;
  setStatusMessage: (statusMessage: string | null) => void;
  setFeed: (args: {
    platform: Platform;
    handle: string;
    filter: FeedFilter;
    posts: BatchPost[];
    note?: string | null;
  }) => void;
  clearSearch: () => void;
  setSelectedIds: (ids: string[]) => void;
  toggleSelected: (id: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  pushRecent: (platform: Platform, handle: string) => void;
};

export const STALE_MS = 30 * 60 * 1000;

export const useBatchStore = create<BatchState>()(
  persist(
    (set, get) => ({
      platform: "x",
      handle: "",
      filter: "media",
      posts: [],
      note: null,
      fetchedAt: null,
      selectedIds: [],
      recentHandles: [],
      statusMessage: null,

      setPlatform(platform) {
        if (!["x", "instagram", "tiktok"].includes(platform)) return;
        set({ platform });
      },

      setHandle(handle) {
        set({ handle: String(handle || "").replace(/^@/, "") });
      },

      setFilter(filter) {
        if (!["media", "original", "all"].includes(filter)) return;
        set({ filter });
      },

      setStatusMessage(statusMessage) {
        set({ statusMessage: statusMessage || null });
      },

      setFeed({ platform, handle, filter, posts, note }) {
        const list = Array.isArray(posts) ? posts : [];
        const ids = new Set(list.map((p) => p?.id).filter(Boolean));
        const prevSelected = get().selectedIds.filter((id) => ids.has(id));
        set({
          platform,
          handle: String(handle || "").replace(/^@/, ""),
          filter,
          posts: list,
          note: note || null,
          fetchedAt: Date.now(),
          selectedIds: prevSelected,
          statusMessage: null,
        });
      },

      clearSearch() {
        set({
          handle: "",
          posts: [],
          note: null,
          fetchedAt: null,
          selectedIds: [],
          statusMessage: null,
        });
      },

      setSelectedIds(ids) {
        set({ selectedIds: [...new Set(ids.map(String))] });
      },

      toggleSelected(id) {
        const sid = String(id);
        const cur = get().selectedIds;
        set({
          selectedIds: cur.includes(sid)
            ? cur.filter((x) => x !== sid)
            : [...cur, sid],
        });
      },

      selectAll() {
        set({
          selectedIds: get()
            .posts.map((p) => p?.id)
            .filter(Boolean)
            .map(String),
        });
      },

      deselectAll() {
        set({ selectedIds: [] });
      },

      pushRecent(platform, handle) {
        const row = {
          platform,
          handle: String(handle || "").replace(/^@/, ""),
        };
        if (!row.handle) return;
        const next = [
          row,
          ...get().recentHandles.filter(
            (r) =>
              !(r.platform === row.platform && r.handle === row.handle),
          ),
        ].slice(0, 8);
        set({ recentHandles: next });
      },
    }),
    {
      name: "social-hub.batch.v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        platform: s.platform,
        handle: s.handle,
        filter: s.filter,
        posts: s.posts,
        note: s.note,
        fetchedAt: s.fetchedAt,
        selectedIds: s.selectedIds,
        recentHandles: s.recentHandles,
      }),
    },
  ),
);

export function feedMatches(
  platform: string,
  handle: string,
  filter: string,
  s: Pick<BatchState, "platform" | "handle" | "filter" | "posts">,
): boolean {
  return (
    s.platform === platform &&
    s.handle.toLowerCase() === handle.replace(/^@/, "").toLowerCase() &&
    s.filter === filter &&
    (s.posts?.length || 0) > 0
  );
}

export function cacheAgeLabel(
  s: Pick<BatchState, "fetchedAt">,
): string | null {
  if (!s.fetchedAt) return null;
  const mins = Math.round((Date.now() - s.fetchedAt) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs === 1 ? "1 hr ago" : `${hrs} hrs ago`;
}
