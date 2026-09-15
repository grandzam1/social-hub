import {
  batchStore,
  whenBatchHydrated,
  feedMatches,
  cacheAgeLabel,
  getBatchState,
} from "/batch-store.js";

const fetchForm = document.getElementById("fetchForm");
const platformEl = document.getElementById("platform");
const handleEl = document.getElementById("handle");
const fetchBtn = document.getElementById("fetchBtn");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const smartHelp = document.getElementById("smartHelp");
const handlePrefix = document.getElementById("handlePrefix");
const recentEl = document.getElementById("recentHandles");
const statusEl = document.getElementById("status");
const noteEl = document.getElementById("note");
const toolbar = document.getElementById("toolbar");
const feedEl = document.getElementById("feed");
const selectAllBtn = document.getElementById("selectAll");
const deselectAllBtn = document.getElementById("deselectAll");
const selectedCountEl = document.getElementById("selectedCount");
const downloadBtn = document.getElementById("downloadBtn");
const progressEl = document.getElementById("progress");
const progressList = document.getElementById("progressList");
const feedSummary = document.getElementById("feedSummary");

/** @type {Map<string, any>} derived from Zustand posts */
const postsById = new Map();

const PLATFORM_LABEL = {
  x: "X",
  instagram: "Instagram",
  tiktok: "TikTok",
};

const EXAMPLE = {
  x: "elonmusk",
  instagram: "natgeo",
  tiktok: "stoolpresidente",
};

function activeFilter() {
  return getBatchState().filter || "media";
}

function selectedSet() {
  return new Set(getBatchState().selectedIds || []);
}

function rebuildPostsMap(posts) {
  postsById.clear();
  for (const p of posts || []) {
    if (p?.id) postsById.set(String(p.id), p);
  }
}

function updateFetchButtonLabel() {
  if (!fetchBtn) return;
  const s = getBatchState();
  const handle = (handleEl.value || s.handle || "").replace(/^@/, "").trim();
  const platform = platformEl.value || s.platform;
  const filter = activeFilter();
  const hasSavedSearch = (s.posts?.length || 0) > 0 && Boolean(s.handle);
  const cached =
    handle &&
    feedMatches(platform, handle, filter, s) &&
    hasSavedSearch;
  fetchBtn.textContent = cached ? "Refresh posts" : "Fetch posts";
  if (clearSearchBtn) clearSearchBtn.hidden = !hasSavedSearch;
}

/**
 * Parse pasted URL / @handle / bare username into { platform?, handle, tip }.
 */
function parseProfileInput(raw) {
  const input = String(raw || "").trim();
  if (!input) {
    return { handle: "", tip: "Paste a profile link or type a username — platform is detected for you." };
  }

  // Full URL / domain path
  const looksLikeUrl =
    /^https?:\/\//i.test(input) ||
    /(?:^|\.)(?:x|twitter|instagram|instagr|tiktok)\.com\b/i.test(input) ||
    /^[\w.-]+\.[a-z]{2,}\//i.test(input);

  if (looksLikeUrl) {
  try {
    const withProto = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    const u = new URL(withProto);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const parts = u.pathname.split("/").filter(Boolean);

    if (host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com") {
      const skip = new Set(["i", "home", "explore", "search", "intent", "share", "hashtag"]);
      let handle = parts[0] || "";
      if (handle.toLowerCase() === "intent" && u.searchParams.get("screen_name")) {
        handle = u.searchParams.get("screen_name") || "";
      }
      // /user/status/123 → still take user
      if (parts[1] === "status" || parts[1] === "statuses") {
        handle = parts[0] || "";
      }
      handle = handle.replace(/^@/, "");
      if (handle && !skip.has(handle.toLowerCase())) {
        return {
          platform: "x",
          handle,
          tip: `Detected X profile → @${handle}. Fetch lists popular posts (1 credit).`,
          fromUrl: true,
        };
      }
    }

    if (host === "instagram.com" || host === "instagr.am") {
      const skip = new Set(["p", "reel", "reels", "tv", "stories", "explore", "accounts"]);
      let handle = parts[0] || "";
      if (skip.has(handle.toLowerCase())) {
        return {
          handle: "",
          tip: "That looks like a post link. Paste a profile URL like instagram.com/natgeo",
          error: true,
        };
      }
      handle = handle.replace(/^@/, "");
      if (handle) {
        return {
          platform: "instagram",
          handle,
          tip: `Detected Instagram → @${handle}. Fetch lists recent posts (1 credit).`,
          fromUrl: true,
        };
      }
    }

    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
      let handle = parts[0] || "";
      if (handle.startsWith("@")) handle = handle.slice(1);
      const skip = new Set(["foryou", "following", "live", "search", "tag", "music", "video"]);
      if (parts[0] === "video" || parts.includes("video")) {
        return {
          handle: "",
          tip: "That looks like a video link. Paste a profile like tiktok.com/@stoolpresidente",
          error: true,
        };
      }
      if (handle && !skip.has(handle.toLowerCase())) {
        return {
          platform: "tiktok",
          handle,
          tip: `Detected TikTok → @${handle}. Fetch lists latest videos (1 credit).`,
          fromUrl: true,
        };
      }
    }
  } catch {
    /* not a URL */
  }
  }

  // Bare / @handle
  let handle = input.replace(/^@+/, "").trim();
  handle = handle.split(/[/?#\s]/)[0] || "";
  handle = handle.replace(/[^a-zA-Z0-9._]/g, "");
  if (!handle) {
    return {
      handle: "",
      tip: "Enter a username like elonmusk, or paste a full profile URL.",
      error: true,
    };
  }

  const platform = platformEl.value || "x";
  return {
    platform,
    handle,
    tip: `Ready: @${handle} on ${PLATFORM_LABEL[platform] || platform}. Step 1 lists posts only (1 credit).`,
  };
}

function setPlatform(platform, { silent } = {}) {
  if (!["x", "instagram", "tiktok"].includes(platform)) return;
  platformEl.value = platform;
  batchStore.getState().setPlatform(platform);
  updateFetchButtonLabel();
  for (const btn of document.querySelectorAll(".platform-pill")) {
    const on = btn.dataset.platform === platform;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  handleEl.placeholder = `${EXAMPLE[platform]} or paste a profile URL`;
  if (!silent) refreshSmartHelp();
}

function refreshSmartHelp() {
  const parsed = parseProfileInput(handleEl.value);
  if (parsed.platform && parsed.fromUrl) {
    setPlatform(parsed.platform, { silent: true });
  }
  if (smartHelp) {
    smartHelp.textContent = parsed.tip;
    smartHelp.classList.toggle("is-error", Boolean(parsed.error));
    smartHelp.classList.toggle("is-ok", Boolean(parsed.handle) && !parsed.error);
  }
  if (handlePrefix) {
    handlePrefix.hidden = Boolean(parsed.fromUrl) || handleEl.value.trim().startsWith("http");
  }
  return parsed;
}

function saveRecent(platform, handle) {
  batchStore.getState().pushRecent(platform, handle);
  renderRecent();
}

function renderRecent() {
  if (!recentEl) return;
  const rows = getBatchState().recentHandles || [];
  if (!rows.length) {
    recentEl.hidden = true;
    recentEl.innerHTML = "";
    return;
  }
  recentEl.hidden = false;
  recentEl.innerHTML = `<span class="recent-label">Recent</span>${rows
    .map(
      (r) =>
        `<button type="button" class="recent-chip" data-platform="${escapeAttr(r.platform)}" data-handle="${escapeAttr(r.handle)}">${escapeHtml(PLATFORM_LABEL[r.platform] || r.platform)} · @${escapeHtml(r.handle)}</button>`,
    )
    .join("")}`;
}

document.querySelectorAll(".platform-pill").forEach((btn) => {
  btn.addEventListener("click", () => {
    setPlatform(btn.dataset.platform);
    handleEl.focus();
  });
});

handleEl.addEventListener("input", () => {
  refreshSmartHelp();
  batchStore.getState().setHandle(handleEl.value.replace(/^@/, "").trim());
  updateFetchButtonLabel();
});
handleEl.addEventListener("paste", () => {
  // Let paste land, then normalize
  requestAnimationFrame(() => {
    const parsed = refreshSmartHelp();
    if (parsed.fromUrl && parsed.handle) {
      handleEl.value = parsed.handle;
      refreshSmartHelp();
    }
  });
});

handleEl.addEventListener("blur", () => {
  const parsed = parseProfileInput(handleEl.value);
  if (parsed.handle && (parsed.fromUrl || handleEl.value.includes("/") || handleEl.value.startsWith("@"))) {
    if (parsed.platform) setPlatform(parsed.platform, { silent: true });
    handleEl.value = parsed.handle;
    refreshSmartHelp();
  }
});

recentEl?.addEventListener("click", (e) => {
  const chip = e.target.closest?.(".recent-chip");
  if (!chip) return;
  setPlatform(chip.dataset.platform);
  handleEl.value = chip.dataset.handle || "";
  batchStore.getState().setHandle(handleEl.value);
  refreshSmartHelp();
  updateFetchButtonLabel();
  const s = getBatchState();
  if (
    feedMatches(chip.dataset.platform, chip.dataset.handle, s.filter, s) &&
    s.posts.length
  ) {
    restoreFeedFromStore({ announce: true });
  }
  handleEl.focus();
});

document.querySelectorAll(".feed-filter").forEach((btn) => {
  btn.addEventListener("click", () => {
    const filter = btn.dataset.filter || "media";
    batchStore.getState().setFilter(filter);
    document.querySelectorAll(".feed-filter").forEach((b) => {
      const on = b.dataset.filter === filter;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    updateFetchButtonLabel();
    // Reuse Zustand cache for this filter — never auto-call the API
    const s = getBatchState();
    const handle = (handleEl.value || s.handle || "").replace(/^@/, "").trim();
    const platform = platformEl.value || s.platform;
    if (handle && feedMatches(platform, handle, filter, s) && s.posts.length) {
      restoreFeedFromStore({ announce: true });
      return;
    }
    if (postsById.size) {
      feedEl.innerHTML = "";
      toolbar.hidden = true;
      if (feedSummary) feedSummary.hidden = true;
      noteEl.hidden = true;
      setStatus(
        `Filter set to ${filter}. Click Refresh/Fetch to load posts (uses 1 credit).`,
      );
    }
  });
});


function escapeAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmt(n) {
  if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat().format(Number(n));
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function dimsLabel(type, w, h) {
  const kind =
    type === "video" || type === "gif"
      ? "Video"
      : type === "carousel"
        ? "Carousel"
        : type === "text"
          ? "Text"
          : "Image";
  if (w && h) return `${kind} — ${w} × ${h}`;
  return kind;
}

/** Route CDN previews through our API so blockers don't blank thumbs. */
function thumbSrc(url) {
  if (!url) return "";
  return `/api/thumb?url=${encodeURIComponent(url)}`;
}

function renderThumb(p, typeLabel) {
  const urls = [
    ...(Array.isArray(p.previewUrls) ? p.previewUrls : []),
    p.thumbnail,
  ].filter((u) => typeof u === "string" && /^https?:\/\//i.test(u));
  const unique = [...new Set(urls)].slice(0, 4);
  if (!unique.length) {
    return `<div class="feed-thumb-empty">${escapeHtml(typeLabel)}</div>`;
  }
  const imgTag = (u, eager) =>
    `<img src="${escapeAttr(thumbSrc(u))}" alt="" ${eager ? 'loading="eager"' : 'loading="lazy"'} decoding="async" referrerpolicy="no-referrer" onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('div'),{className:'feed-thumb-empty',textContent:'No preview'}))" />`;
  if (unique.length === 1) {
    return imgTag(unique[0], true);
  }
  // Carousel mosaic: show up to 4 slide previews (absolute-filled via CSS)
  return `<div class="feed-mosaic feed-mosaic-${Math.min(unique.length, 4)}">${unique
    .map((u, i) => imgTag(u, i < 2))
    .join("")}</div>`;
}
function setStatus(text, isErr = false) {
  statusEl.hidden = !text;
  statusEl.textContent = text || "";
  statusEl.classList.toggle("err", Boolean(isErr));
}

function syncSelectionUi() {
  const selected = selectedSet();
  const n = selected.size;
  selectedCountEl.textContent = `${n} selected`;
  downloadBtn.disabled = n === 0;
  for (const card of feedEl.querySelectorAll(".feed-card")) {
    const id = card.dataset.id;
    const on = selected.has(id);
    card.classList.toggle("is-selected", on);
    const cb = card.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = on;
  }
}

function renderFeed(posts, { resetSelection = false } = {}) {
  rebuildPostsMap(posts);
  if (resetSelection) batchStore.getState().deselectAll();

  if (!posts.length) {
    feedEl.innerHTML = `<p class="muted">No posts matched this filter. Try <strong>All</strong> or another handle.</p>`;
    toolbar.hidden = true;
    if (feedSummary) feedSummary.hidden = true;
    syncSelectionUi();
    return;
  }

  toolbar.hidden = false;
  if (feedSummary) {
    const carousels = posts.filter((p) => (p.mediaCount || 0) > 1).length;
    feedSummary.hidden = false;
    feedSummary.innerHTML = `<strong>${posts.length} posts</strong> ready to select.${
      carousels
        ? ` · ${carousels} carousel${carousels === 1 ? "" : "s"} (multiple files in one post)`
        : ""
    } · Selecting a carousel downloads <em>all</em> its slides.`;
  }

  feedEl.innerHTML = posts
    .map((p) => {
      const slides = Number(p.mediaCount) || 0;
      const typeLabel =
        slides > 1
          ? `Carousel`
          : p.mediaType === "video" || p.mediaType === "gif"
            ? "Video"
            : p.mediaType === "text"
              ? "Text"
              : "Image";
      const thumb = renderThumb(p, typeLabel);
      const slideBadge =
        slides > 1
          ? `<span class="feed-badge feed-badge-slides">${slides} files</span>`
          : "";
      return `
      <article class="feed-card" data-id="${escapeAttr(p.id)}">
        <label class="feed-check">
          <input type="checkbox" data-id="${escapeAttr(p.id)}" />
          <span class="sr">Select post</span>
        </label>
        <div class="feed-thumb">
          ${thumb}
          ${slideBadge}
          <span class="feed-badge">${escapeHtml(typeLabel)}</span>
        </div>
        <div class="feed-body">
          <div class="feed-meta">
            <strong>${escapeHtml(p.handle)}</strong>
            <span>${escapeHtml(fmtDate(p.postedAt))}</span>
          </div>
          <p class="feed-caption">${escapeHtml(p.caption || "(no caption)")}</p>
          <div class="feed-stats" aria-label="Post stats">
            <span class="feed-stat">${escapeHtml(p.mediaType)}</span>
            ${
              slides > 1
                ? `<span class="feed-stat feed-stat-accent">${slides} slides</span>`
                : ""
            }
            ${
              p.repostKind
                ? `<span class="feed-stat feed-stat-mute">${p.repostKind === "retweet" ? "RT" : "Quote"}${p.quotedHandle ? " " + escapeHtml(p.quotedHandle) : ""}</span>`
                : ""
            }
            ${
              p.width && p.height
                ? `<span class="feed-stat">${escapeHtml(String(p.width))}×${escapeHtml(String(p.height))}</span>`
                : ""
            }
            <span class="feed-stat">${fmt(p.likes)} likes</span>
            ${p.views != null ? `<span class="feed-stat">${fmt(p.views)} views</span>` : ""}
          </div>
        </div>
      </article>`;
    })
    .join("");

  syncSelectionUi();
}

function restoreFeedFromStore({ announce = false } = {}) {
  const s = getBatchState();
  rebuildPostsMap(s.posts);
  if (s.note) {
    noteEl.hidden = false;
    noteEl.textContent = s.note;
  } else {
    noteEl.hidden = true;
  }
  renderFeed(s.posts, { resetSelection: false });
  syncSelectionUi();
  updateFetchButtonLabel();
  if (announce) {
    const age = cacheAgeLabel(s) || "just now";
    setStatus(
      `Showing ${s.posts.length} posts for @${s.handle} (saved · ${age}). Stays until you search another user or Clear search.`,
    );
    batchStore.getState().setStatusMessage(statusEl.textContent);
  }
}

feedEl.addEventListener("change", (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement) || t.type !== "checkbox") return;
  const id = t.dataset.id;
  if (!id) return;
  const selected = selectedSet();
  if (t.checked) selected.add(id);
  else selected.delete(id);
  batchStore.getState().setSelectedIds([...selected]);
  syncSelectionUi();
});

feedEl.addEventListener("click", (e) => {
  const card = e.target.closest?.(".feed-card");
  if (!card || e.target.closest("a, input, label")) return;
  const id = card.dataset.id;
  if (!id) return;
  batchStore.getState().toggleSelected(id);
  syncSelectionUi();
});

selectAllBtn.addEventListener("click", () => {
  batchStore.getState().selectAll();
  syncSelectionUi();
});

deselectAllBtn.addEventListener("click", () => {
  batchStore.getState().deselectAll();
  syncSelectionUi();
});

fetchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const parsed = refreshSmartHelp();
  if (!parsed.handle || parsed.error) {
    setStatus(parsed.tip || "Enter a valid username or profile URL.", true);
    handleEl.focus();
    return;
  }
  if (parsed.platform) setPlatform(parsed.platform, { silent: true });
  handleEl.value = parsed.handle;

  const platform = platformEl.value;
  const handle = parsed.handle;
  const filter = activeFilter();

  // Explicit Fetch/Refresh always hits the API (user requested).
  fetchBtn.disabled = true;
  progressEl.hidden = true;
  progressList.innerHTML = "";
  setStatus(`Fetching @${handle} on ${PLATFORM_LABEL[platform]} (list only)…`);
  noteEl.hidden = true;
  feedEl.innerHTML = "";
  toolbar.hidden = true;

  try {
    const qs = new URLSearchParams({
      platform,
      handle,
      limit: "24",
      filter,
    });
    const res = await fetch(`/api/recent-posts?${qs}`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `Fetch failed (${res.status})`);

    saveRecent(platform, handle);
    batchStore.getState().setFeed({
      platform,
      handle: data.handle || handle,
      filter,
      posts: data.posts || [],
      note: data.note || null,
    });

    if (typeof window.setCreditsBar === "function" && data.creditsRemaining != null) {
      window.setCreditsBar({
        remaining: data.creditsRemaining,
        charged: data.creditsCharged ?? 0,
      });
    }

    if (data.note) {
      noteEl.hidden = false;
      noteEl.textContent = data.note;
    }

    renderFeed(data.posts || [], { resetSelection: false });
    syncSelectionUi();
    updateFetchButtonLabel();
    const msg = `Showing ${(data.posts || []).length} posts for ${data.handle}. Saved in this browser until Clear or another search.`;
    setStatus(msg);
    batchStore.getState().setStatusMessage(msg);
  } catch (err) {
    setStatus(err.message || String(err), true);
  } finally {
    fetchBtn.disabled = false;
  }
});

function progressRowHtml(id, post) {
  const label = (post.caption || post.url || id).slice(0, 48);
  const dims =
    post.width && post.height
      ? dimsLabel(post.mediaType, post.width, post.height)
      : dimsLabel(post.mediaType);
  return `
    <li class="progress-row" data-id="${escapeAttr(id)}" data-state="pending">
      <div class="progress-main">
        <span class="progress-name">${escapeHtml(label)}</span>
        <span class="progress-dims">${escapeHtml(dims)}</span>
        <span class="progress-state">Queued</span>
      </div>
      <div class="progress-bar"><i style="width:0%"></i></div>
    </li>`;
}

function updateProgressRow(id, patch) {
  const row = progressList.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  if (patch.state) row.dataset.state = patch.state;
  const stateEl = row.querySelector(".progress-state");
  const dimsEl = row.querySelector(".progress-dims");
  const bar = row.querySelector(".progress-bar i");
  if (stateEl && patch.label != null) stateEl.textContent = patch.label;
  if (dimsEl && patch.dims) dimsEl.textContent = patch.dims;
  if (bar && patch.pct != null) bar.style.width = `${patch.pct}%`;
}

downloadBtn.addEventListener("click", async () => {
  const ids = [...selectedSet()];
  if (!ids.length) return;

  downloadBtn.disabled = true;
  fetchBtn.disabled = true;
  progressEl.hidden = false;
  progressList.innerHTML = ids
    .map((id) => progressRowHtml(id, postsById.get(id) || { id }))
    .join("");

  setStatus(`Downloading ${ids.length} selected post(s) → R2 + Airtable…`);

  let okCount = 0;
  let failCount = 0;
  /** @type {string[]} */
  const failReasons = [];

  async function scrapeOnce(url) {
    const res = await fetch("/api/scrape-post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        saveToR2: true,
      }),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      throw new Error(`Bad response (${res.status})`);
    }
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `Failed (${res.status})`);
    }
    return data;
  }

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const post = postsById.get(id);
    if (!post?.url) {
      updateProgressRow(id, { state: "err", label: "Missing URL", pct: 100 });
      failReasons.push("Missing URL");
      failCount++;
      continue;
    }

    updateProgressRow(id, { state: "run", label: "Scraping…", pct: 18 });

    try {
      let data;
      try {
        data = await scrapeOnce(post.url);
      } catch (firstErr) {
        // One automatic retry for transient network / API blips
        updateProgressRow(id, { state: "run", label: "Retrying…", pct: 35 });
        data = await scrapeOnce(post.url);
      }
      updateProgressRow(id, { state: "run", label: "Saving…", pct: 55 });

      if (typeof window.setCreditsBar === "function") {
        window.setCreditsBar({
          remaining: data.creditsRemaining,
          charged: data.creditsCharged ?? 0,
        });
      }

      const media = [...(data.media || [])].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0),
      );
      const first = media[0];
      const dims = first
        ? dimsLabel(first.type, first.width, first.height)
        : dimsLabel(post.mediaType, post.width, post.height);
      const saved = media.filter((m) => m.savedCopy).length;
      const total = media.length;
      const queued = data.saveMode === "async";
      const label = queued
        ? `Queued R2 · ${total} file(s)`
        : saved === total && total > 0
          ? `Saved · R2 + Airtable`
          : total
            ? `Airtable · ${saved}/${total} R2`
            : "Saved (no media)";

      updateProgressRow(id, {
        state: "ok",
        label: queued ? `${label} ✓` : `${label} ✓`,
        dims,
        pct: 100,
      });
      batchStore.getState().setDownloadResult(id, {
        ok: true,
        label,
        dims,
        media: media.map((m) => ({
          type: m.type,
          width: m.width,
          height: m.height,
          order: m.order,
          url: m.url || m.cdnUrl || m.savedCopy?.publicUrl || null,
          r2Key: m.savedCopy?.key || null,
        })),
      });
      okCount++;
    } catch (err) {
      const reason = err?.message || String(err);
      updateProgressRow(id, {
        state: "err",
        label: reason,
        pct: 100,
      });
      batchStore.getState().setDownloadResult(id, {
        ok: false,
        error: reason,
      });
      failReasons.push(reason);
      failCount++;
    }
  }

  const firstFail = failReasons[0] ? ` — ${failReasons[0]}` : "";
  const more =
    failReasons.length > 1 ? ` (+${failReasons.length - 1} more)` : "";
  const msg = `Done · ${okCount} ok${
    failCount ? ` · ${failCount} failed${firstFail}${more}` : ""
  }. See Saved Scraps for the library.`;
  setStatus(msg, failCount > 0);
  batchStore.getState().setStatusMessage(msg);
  downloadBtn.disabled = selectedSet().size === 0;
  fetchBtn.disabled = false;
});


function clearCurrentSearch() {
  batchStore.getState().clearSearch();
  handleEl.value = "";
  postsById.clear();
  feedEl.innerHTML = "";
  toolbar.hidden = true;
  if (feedSummary) feedSummary.hidden = true;
  noteEl.hidden = true;
  progressEl.hidden = true;
  progressList.innerHTML = "";
  setStatus("Search cleared. Enter a handle to fetch posts.");
  refreshSmartHelp();
  updateFetchButtonLabel();
  syncSelectionUi();
  handleEl.focus();
}

clearSearchBtn?.addEventListener("click", clearCurrentSearch);

async function bootFromStore() {
  const s = await whenBatchHydrated();
  if (s.platform) setPlatform(s.platform, { silent: true });
  if (s.handle) handleEl.value = s.handle;
  const filter = s.filter || "media";
  batchStore.getState().setFilter(filter);
  document.querySelectorAll(".feed-filter").forEach((b) => {
    const on = b.dataset.filter === filter;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  refreshSmartHelp();
  renderRecent();
  updateFetchButtonLabel();

  if (s.posts?.length && s.handle) {
    restoreFeedFromStore({ announce: true });
  } else if (s.statusMessage) {
    setStatus(s.statusMessage);
  }
}

bootFromStore();
