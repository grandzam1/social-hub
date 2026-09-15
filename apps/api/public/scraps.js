const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const statusEl = document.getElementById("libStatus");
const userFilter = document.getElementById("userFilter");
const searchInput = document.getElementById("search");
const tabs = [...document.querySelectorAll(".tab")];

let state = {
  type: "all",
  user: "all",
  q: "",
  items: [],
  users: [],
  counts: { all: 0, text: 0, image: 0, video: 0 },
};

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function fmtWhen(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch {
    return "—";
  }
}

function platformGlyph(platform) {
  const p = String(platform || "").toLowerCase();
  if (p === "x" || p === "twitter") return "𝕏";
  if (p === "instagram") return "IG";
  if (p === "tiktok") return "TT";
  return "•";
}

/** Clean duplicated RT / em-dash scrapes into one readable caption. */
function normalizeCaption(raw) {
  let t = String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
  if (!t) return "";

  const chunks = t
    .split(/\s*[—–]{1,2}\s*|\n{2,}/)
    .map((c) => c.trim())
    .filter(Boolean);

  const stripRt = (s) => s.replace(/^RT\s+@[\w.]+:\s*/i, "").trim();

  if (chunks.length > 1) {
    const ranked = chunks
      .map((c) => ({ raw: c, body: stripRt(c).toLowerCase() }))
      .filter((c) => c.body.length > 0)
      .sort((a, b) => b.body.length - a.body.length);

    const kept = [];
    const seen = [];
    for (const row of ranked) {
      const dup = seen.some(
        (s) => s.includes(row.body) || row.body.includes(s.slice(0, 48)),
      );
      if (dup) continue;
      seen.push(row.body);
      kept.push(row.raw);
    }
    t = kept[0] || t;
  }

  t = stripRt(t) ? t : t;
  // Prefer body without RT prefix when the rest is the same length-ish
  const noRt = stripRt(t);
  if (noRt && noRt.length >= Math.min(40, t.length * 0.5)) {
    // Keep RT attribution only if it's short
    if (/^RT\s+@/i.test(t) && noRt.length > 20) t = noRt;
  }

  t = t
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();

  return t;
}

function statusBadge(post) {
  const statuses = post.media.map((m) => m.fileStatus).filter(Boolean);
  if (statuses.some((s) => /saved copy ready/i.test(s))) {
    return { label: "Saved", tone: "ok" };
  }
  if (statuses.some((s) => /file link ready/i.test(s))) {
    return { label: "File link ready", tone: "warn" };
  }
  if (post.media.length === 0) {
    return { label: "Text", tone: "neutral" };
  }
  const first = statuses[0];
  return first
    ? { label: first, tone: "neutral" }
    : { label: post.media[0]?.kind || "Media", tone: "neutral" };
}

function groupPosts(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.postRecordId || item.id;
    if (!map.has(key)) {
      map.set(key, {
        key,
        user: item.user || "unknown",
        avatarUrl: item.avatarUrl || "",
        platform: item.platform || "",
        postLink: item.postLink || "",
        savedAt: item.savedAt || "",
        text: item.text || "",
        media: [],
      });
    }
    const g = map.get(key);
    if (item.user) g.user = item.user;
    if (item.avatarUrl) g.avatarUrl = item.avatarUrl;
    if (item.platform) g.platform = item.platform;
    if (item.postLink) g.postLink = item.postLink;
    if (item.text) g.text = item.text;
    if (item.savedAt && (!g.savedAt || item.savedAt > g.savedAt)) {
      g.savedAt = item.savedAt;
    }

    const hasFile = Boolean(item.fileUrl || item.previewUrl);
    if (item.kind === "text" && !hasFile) continue;
    if (item.kind === "image" || item.kind === "video") {
      g.media.push(item);
    }
  }

  const posts = [...map.values()];
  for (const p of posts) {
    p.media.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  posts.sort(
    (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
  );
  return posts;
}

function pickLayout(media) {
  const n = media.length;
  if (n === 0) return "text";
  const ready = media.filter((m) => m.fileUrl || m.previewUrl);
  if (ready.length === 0) return "empty";
  if (n === 1) return "single";
  return "slider";
}

function mediaSrc(item) {
  return item.previewUrl || item.fileUrl || "";
}

function isLikelyVideoUrl(url) {
  return /\.(mp4|mov|webm|m4v|m3u8)(\?|#|$)/i.test(String(url || ""));
}

function isLikelyImageUrl(url) {
  const u = String(url || "");
  if (!u || isLikelyVideoUrl(u)) return false;
  return true;
}

function mediaCellHtml(item, opts = {}) {
  const open = item.fileUrl || item.previewUrl || "";
  const kind = item.kind === "video" ? "video" : "image";

  if (kind === "video") {
    const videoSrc =
      item.fileUrl ||
      (isLikelyVideoUrl(item.previewUrl) ? item.previewUrl : "") ||
      "";
    const poster = isLikelyImageUrl(item.previewUrl) ? item.previewUrl : "";
    if (!videoSrc) {
      return `<figure class="media-cell kind-video is-empty">
      <div class="media-spinner" aria-hidden="true"></div>
      <span class="media-empty-label">Waiting</span>
    </figure>`;
    }
    const autoplay =
      typeof window.SocialHubMedia !== "undefined" &&
      window.SocialHubMedia.getAutoplay();
    const forceControls = opts.controls ? "1" : "0";
    return `<figure class="media-cell kind-video">
      <video
        class="media-el"
        data-media-video
        data-force-controls="${forceControls}"
        playsinline
        muted
        preload="metadata"
        ${poster ? `poster="${escapeAttr(poster)}"` : ""}
        src="${escapeAttr(videoSrc)}"
        ${opts.controls && !autoplay ? "controls" : ""}
      ></video>
      ${
        autoplay
          ? ""
          : `<button type="button" class="media-play" aria-label="Play video"></button>`
      }
      <span class="media-kind-tag">video</span>
    </figure>`;
  }

  const src = mediaSrc(item);
  if (!src) {
    return `<figure class="media-cell kind-image is-empty">
      <div class="media-spinner" aria-hidden="true"></div>
      <span class="media-empty-label">Waiting</span>
    </figure>`;
  }

  const img = `<img class="media-el" src="${escapeAttr(src)}" alt="" loading="lazy" />`;
  if (open) {
    return `<figure class="media-cell kind-image">
      <a class="media-hit" href="${escapeAttr(open)}" target="_blank" rel="noreferrer">${img}</a>
    </figure>`;
  }
  return `<figure class="media-cell kind-image">${img}</figure>`;
}

function mediaStripHtml(post) {
  const layout = pickLayout(post.media);
  if (layout === "text") return "";
  if (layout === "empty") {
    return `<div class="post-media" data-layout="empty">
      <figure class="media-cell is-empty is-wide">
        <div class="media-spinner" aria-hidden="true"></div>
        <span class="media-empty-label">File link ready — waiting for saved copy</span>
      </figure>
    </div>`;
  }
  if (layout === "single") {
    const m = post.media[0];
    return `<div class="post-media" data-layout="single">${mediaCellHtml(m, { controls: m.kind === "video" })}</div>`;
  }

  const slides = post.media
    .map(
      (m, i) =>
        `<div class="media-slide${i === 0 ? " is-active" : ""}" data-slide="${i}">${mediaCellHtml(m, { controls: m.kind === "video" })}</div>`,
    )
    .join("");
  const dots = post.media
    .map(
      (_, i) =>
        `<button type="button" class="slider-dot${i === 0 ? " is-active" : ""}" data-goto="${i}" aria-label="Slide ${i + 1}"></button>`,
    )
    .join("");

  return `<div class="post-media" data-layout="slider">
    <div class="media-slider" data-index="0" data-count="${post.media.length}">
      <div class="media-slider-viewport">
        <div class="media-slider-track">${slides}</div>
      </div>
      <button type="button" class="slider-nav prev" aria-label="Previous media">‹</button>
      <button type="button" class="slider-nav next" aria-label="Next media">›</button>
      <div class="slider-chrome">
        <div class="slider-dots">${dots}</div>
        <span class="slider-count">1 / ${post.media.length}</span>
      </div>
    </div>
  </div>`;
}

function avatarHtml(post) {
  if (post.avatarUrl) {
    const hi = String(post.avatarUrl).replace("_normal.", "_400x400.");
    return `<img class="post-avatar-img" src="${escapeAttr(hi)}" alt="" loading="lazy" width="40" height="40" />`;
  }
  return `<span class="post-avatar-fallback" aria-hidden="true">${escapeHtml(platformGlyph(post.platform))}</span>`;
}

function captionBlockHtml(caption) {
  if (!caption) return "";
  const display =
    caption.length > 520 ? `${caption.slice(0, 520)}…` : caption;
  return `<div class="post-caption-wrap">
    <p class="post-caption">${escapeHtml(display)}</p>
    <button type="button" class="caption-copy" data-copy="${escapeAttr(caption)}" aria-label="Copy caption" title="Copy caption">
      <span class="caption-copy-label">Copy</span>
    </button>
  </div>`;
}

function postCardHtml(post) {
  const badge = statusBadge(post);
  const caption = normalizeCaption(post.text || "");
  const layout = pickLayout(post.media);

  return `
    <article class="post-card" data-platform="${escapeAttr(post.platform || "")}" data-layout="${layout}" data-post="${escapeAttr(post.key)}">
      <header class="post-card-head">
        <div class="post-avatar">${avatarHtml(post)}</div>
        <div class="post-identity">
          <div class="post-identity-row">
            <span class="post-name">${escapeHtml(post.user)}</span>
            <span class="post-badge tone-${badge.tone}">${escapeHtml(badge.label)}</span>
            <time class="post-when" datetime="${escapeAttr(post.savedAt)}">${escapeHtml(fmtWhen(post.savedAt))}</time>
          </div>
          ${
            post.platform
              ? `<span class="post-platform">${escapeHtml(post.platform)}</span>`
              : ""
          }
        </div>
        ${
          post.postLink
            ? `<a class="post-menu" href="${escapeAttr(post.postLink)}" target="_blank" rel="noreferrer" aria-label="Open original" title="Open original">⋯</a>`
            : `<span class="post-menu is-disabled" aria-hidden="true">⋯</span>`
        }
      </header>

      ${captionBlockHtml(caption)}
      ${mediaStripHtml(post)}

      <footer class="post-card-foot">
        <div class="post-foot-pills">
          ${post.media
            .slice(0, 3)
            .map((m) =>
              m.fileStatus
                ? `<span class="pill">${escapeHtml(m.kind)} · ${escapeHtml(m.fileStatus)}</span>`
                : `<span class="pill">${escapeHtml(m.kind)}</span>`,
            )
            .join("")}
          ${post.media.length === 0 ? `<span class="pill">text</span>` : ""}
        </div>
        ${
          post.postLink
            ? `<a class="post-open" href="${escapeAttr(post.postLink)}" target="_blank" rel="noreferrer">Open original</a>`
            : ""
        }
      </footer>
    </article>
  `;
}

function updateTabCounts() {
  for (const tab of tabs) {
    const t = tab.dataset.type;
    const n = state.counts[t] ?? state.counts.all;
    const label =
      t === "all"
        ? `All (${n})`
        : t === "text"
          ? `Text (${n})`
          : t === "image"
            ? `Images (${n})`
            : `Videos (${n})`;
    tab.textContent = label;
  }
}

function fillUsers() {
  const current = userFilter.value || "all";
  userFilter.innerHTML = `<option value="all">All users</option>`;
  for (const u of state.users) {
    const opt = document.createElement("option");
    opt.value = u;
    opt.textContent = u;
    userFilter.appendChild(opt);
  }
  userFilter.value = state.users.includes(current) ? current : "all";
}

function setSliderIndex(slider, index, { animate = true } = {}) {
  const count = Number(slider.dataset.count || 0);
  if (!count) return;
  const next = ((index % count) + count) % count;
  slider.dataset.index = String(next);
  const track = slider.querySelector(".media-slider-track");
  if (track) {
    track.style.transition = animate
      ? "transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)"
      : "none";
    track.style.transform = `translate3d(-${next * 100}%, 0, 0)`;
  }
  for (const slide of slider.querySelectorAll(".media-slide")) {
    slide.classList.toggle(
      "is-active",
      Number(slide.dataset.slide) === next,
    );
  }
  for (const dot of slider.querySelectorAll(".slider-dot")) {
    dot.classList.toggle("is-active", Number(dot.dataset.goto) === next);
  }
  const countEl = slider.querySelector(".slider-count");
  if (countEl) countEl.textContent = `${next + 1} / ${count}`;
  for (const slide of slider.querySelectorAll(".media-slide")) {
    const video = slide.querySelector("video");
    if (!video) continue;
    if (slide.classList.contains("is-active")) continue;
    video.pause();
  }
  window.SocialHubMedia?.observeRoot(slider);
}

/** Pointer / touch swipe on multi-media carousels. */
let swipeState = null;
let suppressClickUntil = 0;

function swipeIgnoreTarget(t) {
  return Boolean(
    t?.closest?.(
      "a, button, video, .media-play, .slider-nav, .slider-dot, input, textarea",
    ),
  );
}

function onSliderPointerDown(e) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const viewport = e.target.closest?.(".media-slider-viewport");
  if (!viewport || swipeIgnoreTarget(e.target)) return;
  const slider = viewport.closest(".media-slider");
  const track = slider?.querySelector(".media-slider-track");
  if (!slider || !track) return;
  swipeState = {
    slider,
    viewport,
    track,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    index: Number(slider.dataset.index || 0),
    width: viewport.clientWidth || 1,
    dragging: false,
  };
  try {
    viewport.setPointerCapture(e.pointerId);
  } catch (_) {}
}

function onSliderPointerMove(e) {
  if (!swipeState || e.pointerId !== swipeState.pointerId) return;
  const dx = e.clientX - swipeState.startX;
  const dy = e.clientY - swipeState.startY;
  if (!swipeState.dragging) {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    if (Math.abs(dy) > Math.abs(dx)) {
      swipeState = null;
      return;
    }
    swipeState.dragging = true;
    swipeState.track.style.transition = "none";
  }
  e.preventDefault();
  const base = -swipeState.index * swipeState.width;
  const maxDrag = swipeState.width * 0.4;
  const clamped = Math.max(-maxDrag, Math.min(maxDrag, dx));
  swipeState.track.style.transform = `translate3d(${base + clamped}px, 0, 0)`;
}

function onSliderPointerUp(e) {
  if (!swipeState || e.pointerId !== swipeState.pointerId) return;
  const { slider, track, index, startX, dragging, width } = swipeState;
  const dx = e.clientX - startX;
  const wasDragging = dragging;
  swipeState = null;
  if (!wasDragging) {
    track.style.transition = "";
    setSliderIndex(slider, index, { animate: false });
    return;
  }
  suppressClickUntil = Date.now() + 350;
  const threshold = Math.min(64, width * 0.18);
  if (dx <= -threshold) setSliderIndex(slider, index + 1);
  else if (dx >= threshold) setSliderIndex(slider, index - 1);
  else setSliderIndex(slider, index);
}

function render() {
  updateTabCounts();
  if (!state.items.length) {
    grid.innerHTML = "";
    empty.hidden = false;
    statusEl.textContent = "0 scraps";
    return;
  }
  empty.hidden = true;
  const posts = groupPosts(state.items);
  statusEl.textContent = `${posts.length} post${posts.length === 1 ? "" : "s"} · ${state.items.length} file${state.items.length === 1 ? "" : "s"}`;
  grid.innerHTML = posts.map(postCardHtml).join("");
  for (const slider of grid.querySelectorAll(".media-slider")) {
    setSliderIndex(slider, Number(slider.dataset.index || 0), { animate: false });
  }
  window.SocialHubMedia?.observeRoot(grid);
}

async function load() {
  statusEl.textContent = "Loading scraps…";
  statusEl.classList.remove("err");
  empty.hidden = true;
  const qs = new URLSearchParams({
    type: state.type,
    user: state.user === "all" ? "" : state.user,
    q: state.q,
  });
  try {
    const res = await fetch(`/api/scraps?${qs}`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Failed to load");
    state.items = data.items || [];
    state.users = data.users || [];
    state.counts = data.counts || state.counts;
    fillUsers();
    render();
  } catch (err) {
    statusEl.textContent = err.message || String(err);
    statusEl.classList.add("err");
    grid.innerHTML = "";
    empty.hidden = true;
  }
}

grid.addEventListener("pointerdown", onSliderPointerDown);
grid.addEventListener("pointermove", onSliderPointerMove);
grid.addEventListener("pointerup", onSliderPointerUp);
grid.addEventListener("pointercancel", onSliderPointerUp);

grid.addEventListener("click", async (e) => {
  if (Date.now() < suppressClickUntil) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const copyBtn = e.target.closest?.(".caption-copy");
  if (copyBtn) {
    e.preventDefault();
    const text = copyBtn.getAttribute("data-copy") || "";
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.classList.add("is-copied");
      const label = copyBtn.querySelector(".caption-copy-label");
      if (label) label.textContent = "Copied";
      setTimeout(() => {
        copyBtn.classList.remove("is-copied");
        if (label) label.textContent = "Copy";
      }, 1400);
    } catch (_) {
      copyBtn.classList.add("is-failed");
      setTimeout(() => copyBtn.classList.remove("is-failed"), 1400);
    }
    return;
  }

  const nav = e.target.closest?.(".slider-nav");
  if (nav) {
    e.preventDefault();
    const slider = nav.closest(".media-slider");
    if (!slider) return;
    const cur = Number(slider.dataset.index || 0);
    setSliderIndex(slider, nav.classList.contains("next") ? cur + 1 : cur - 1);
    return;
  }

  const dot = e.target.closest?.(".slider-dot");
  if (dot) {
    e.preventDefault();
    const slider = dot.closest(".media-slider");
    if (!slider) return;
    setSliderIndex(slider, Number(dot.dataset.goto || 0));
    return;
  }

  const btn = e.target.closest?.(".media-play");
  if (!btn) return;
  const cell = btn.closest(".media-cell");
  const video = cell?.querySelector("video");
  if (!video) return;
  e.preventDefault();
  video.controls = true;
  video.dataset.forceControls = "1";
  btn.remove();
  video.muted = false;
  video.play().catch(() => {});
});

/* Side rail subtaps */
const subtabs = [...document.querySelectorAll(".subtab")];
const panelBrowse = document.getElementById("panelBrowse");
const panelSettings = document.getElementById("panelSettings");

function showRailPanel(name) {
  const browse = name === "browse";
  panelBrowse.hidden = !browse;
  panelSettings.hidden = browse;
  for (const tab of subtabs) {
    const on = tab.dataset.panel === name;
    tab.classList.toggle("is-active", on);
    tab.setAttribute("aria-selected", on ? "true" : "false");
  }
}

for (const tab of subtabs) {
  tab.addEventListener("click", () => showRailPanel(tab.dataset.panel || "browse"));
}

window.SocialHubMedia?.bindToggle(document.getElementById("autoplayVideos"));
window.SocialHubMedia?.subscribe(() => {
  if (state.items.length) render();
});

for (const tab of tabs) {
  tab.addEventListener("click", () => {
    for (const t of tabs) t.classList.toggle("is-active", t === tab);
    state.type = tab.dataset.type || "all";
    load();
  });
}

userFilter.addEventListener("change", () => {
  state.user = userFilter.value || "all";
  load();
});

let searchTimer;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = searchInput.value.trim();
    load();
  }, 250);
});

load();
