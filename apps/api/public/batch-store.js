/**
 * Batch page state — Zustand vanilla + persist (localStorage).
 * Stores post metadata + URLs only (never media blobs).
 */
import { createStore } from "/vendor/zustand/vanilla.mjs";
import { persist, createJSONStorage } from "/vendor/zustand/middleware.mjs";

/** @typedef {"x"|"instagram"|"tiktok"} Platform */
/** @typedef {"media"|"original"|"all"} FeedFilter */

/** Age hint only — search is kept until Clear or a new user fetch. */
export const STALE_MS = 30 * 60 * 1000;

const LEGACY_RECENT_KEY = "social-hub.batch.recent";

function loadLegacyRecent() {
  try {
    const rows = JSON.parse(localStorage.getItem(LEGACY_RECENT_KEY) || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/**
 * @typedef {object} BatchState
 * @property {Platform} platform
 * @property {string} handle
 * @property {FeedFilter} filter
 * @property {any[]} posts
 * @property {string|null} note
 * @property {number|null} fetchedAt
 * @property {string[]} selectedIds
 * @property {{platform: Platform, handle: string}[]} recentHandles
 * @property {string|null} statusMessage
 * @property {Record<string, { ok: boolean, label?: string, dims?: string, media?: any[], error?: string }>} downloadResults
 */

export const batchStore = createStore(
  persist(
    (set, get) => ({
      platform: /** @type {Platform} */ ("x"),
      handle: "",
      filter: /** @type {FeedFilter} */ ("media"),
      posts: [],
      note: null,
      fetchedAt: null,
      selectedIds: [],
      recentHandles: loadLegacyRecent(),
      statusMessage: null,
      downloadResults: {},

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

      /**
       * Replace feed after an explicit fetch. Selection resets to posts still present.
       */
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

      clearFeed() {
        set({
          posts: [],
          note: null,
          fetchedAt: null,
          selectedIds: [],
          statusMessage: null,
        });
      },

      /** Wipe current search (handle + feed + selection). Keeps recent-handle chips. */
      clearSearch() {
        set({
          handle: "",
          posts: [],
          note: null,
          fetchedAt: null,
          selectedIds: [],
          statusMessage: null,
          downloadResults: {},
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
              !(
                r.platform === row.platform &&
                r.handle.toLowerCase() === row.handle.toLowerCase()
              ),
          ),
        ].slice(0, 6);
        set({ recentHandles: next });
        try {
          localStorage.setItem(LEGACY_RECENT_KEY, JSON.stringify(next));
        } catch {
          /* ignore quota */
        }
      },

      setDownloadResult(id, result) {
        set({
          downloadResults: {
            ...get().downloadResults,
            [String(id)]: result,
          },
        });
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
        statusMessage: s.statusMessage,
        downloadResults: s.downloadResults,
      }),
    },
  ),
);

export function getBatchState() {
  return batchStore.getState();
}

/** Same creator + filter as the cached feed. */
export function feedMatches(platform, handle, filter, state = getBatchState()) {
  const h = String(handle || "")
    .replace(/^@/, "")
    .toLowerCase();
  return (
    state.platform === platform &&
    String(state.handle || "").toLowerCase() === h &&
    state.filter === filter &&
    Array.isArray(state.posts)
  );
}

export function isFeedFresh(state = getBatchState()) {
  if (!state.fetchedAt || !state.posts?.length) return false;
  return Date.now() - state.fetchedAt < STALE_MS;
}

export function cacheAgeLabel(state = getBatchState()) {
  if (!state.fetchedAt) return "";
  const mins = Math.max(0, Math.round((Date.now() - state.fetchedAt) / 60000));
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs === 1 ? "1 hr ago" : `${hrs} hrs ago`;
}

/** Wait until persist has rehydrated from localStorage. */
export function whenBatchHydrated() {
  return new Promise((resolve) => {
    const api = batchStore.persist;
    if (api.hasHydrated()) {
      resolve(getBatchState());
      return;
    }
    api.onFinishHydration(() => resolve(getBatchState()));
  });
}
