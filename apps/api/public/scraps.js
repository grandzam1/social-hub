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
  const statuses = post.media.map((m) => m.saveStatus).filter(Boolean);
  if (statuses.length && statuses.every((s) => s === "saved")) {
    return { label: "Saved", tone: "ok" };
  }
  if (statuses.some((s) => s === "failed")) {
    return { label: "Failed", tone: "warn" };
  }
  if (statuses.some((s) => s === "pending")) {
    return { label: "Pending", tone: "warn" };
  }
  if (post.media.length === 0) {
    return { label: "Text", tone: "neutral" };
  }
  return { label: post.media[0]?.kind || "Media", tone: "neutral" };
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

    if (item.kind === "text") continue;
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
  if (n === 1) return "single";
  return "slider";
}

function savedCopyOf(item) {
  if (item.saveStatus !== "saved") return "";
  return item.savedCopy || item.fileUrl || "";
}

function slideLabel(item, index) {
  const kind = item.kind === "video" ? "Video" : "Image";
  const n = (typeof item.order === "number" ? item.order : index) + 1;
  return `${kind} ${n}`;
}

function mediaAttr(item) {
  const id = item.mediaRecordId || "";
  return id ? ` data-media="${escapeAttr(id)}"` : "";
}

function pendingCell(item, kind) {
  return `<figure class="media-cell kind-${kind} is-empty is-pending"${mediaAttr(item)}>
      <div class="media-spinner" aria-hidden="true"></div>
      <span class="media-empty-label">Waiting for saved copy</span>
    </figure>`;
}

function failedCell(item, kind) {
  return `<figure class="media-cell kind-${kind} is-empty is-failed"${mediaAttr(item)}>
      <span class="media-empty-label">Save failed</span>
    </figure>`;
}

function mediaCellHtml(item, opts = {}) {
  const kind = item.kind === "video" ? "video" : "image";
  const status = item.saveStatus || "pending";
  if (status === "failed") return failedCell(item, kind);
  const src = savedCopyOf(item);
  if (status !== "saved" || !src) return pendingCell(item, kind);

  if (kind === "video") {
    const watch = Boolean(opts.watch);
    const autoplay =
      !watch &&
      typeof window.SocialHubMedia !== "undefined" &&
      window.SocialHubMedia.getAutoplay();
    const forceControls = watch || opts.controls ? "1" : "0";
    return `<figure class="media-cell kind-video"${mediaAttr(item)}>
      <video
        class="media-el"
        data-media-video
        data-force-controls="${forceControls}"
        playsinline
        ${watch ? "" : "muted"}
        preload="metadata"
        src="${escapeAttr(src)}"
        ${watch || (opts.controls && !autoplay) ? "controls" : ""}
      ></video>
      ${
        watch || autoplay
          ? ""
          : `<button type="button" class="media-play" aria-label="Play video"></button>`
      }
      <span class="media-kind-tag">video</span>
    </figure>`;
  }

  const img = `<img class="media-el" src="${escapeAttr(src)}" alt="" loading="lazy" />`;
  if (opts.watch) {
    return `<figure class="media-cell kind-image"${mediaAttr(item)}>${img}</figure>`;
  }
  return `<figure class="media-cell kind-image"${mediaAttr(item)}>
      <button type="button" class="media-hit" aria-label="View media">${img}</button>
    </figure>`;
}

function mediaStripHtml(post) {
  const layout = pickLayout(post.media);
  if (layout === "text") return "";
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
  const fallback = `<span class="post-avatar-fallback" aria-hidden="true">${escapeHtml(platformGlyph(post.platform))}</span>`;
  if (!post.avatarUrl) return fallback;
  const hi = String(post.avatarUrl).replace("_normal.", "_400x400.");
  return `<img class="post-avatar-img" src="${escapeAttr(hi)}" alt="" width="40" height="40" onerror="this.hidden=true;var n=this.nextElementSibling;if(n)n.hidden=false" />${fallback.replace("aria-hidden=\"true\"", "hidden")}`;
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

function saveButtonHtml(post) {
  if (!post.media.length) return "";
  const ready = post.media.some((m) => savedCopyOf(m));
  return `<button type="button" class="post-save"${ready ? "" : " disabled"} aria-label="Save media to your device" title="Save the current file to your device">Save</button>`;
}

function headerMenuHtml(post) {
  if (!post.media.length) {
    return `<span class="post-menu is-disabled" aria-hidden="true">⋯</span>`;
  }
  const original = post.postLink
    ? `<a class="post-menu-link" href="${escapeAttr(post.postLink)}" target="_blank" rel="noreferrer">Open original</a>`
    : "";
  return `<div class="post-menu-wrap">
      <button type="button" class="post-menu" aria-expanded="false" aria-label="Post actions" title="Post actions">⋯</button>
      <div class="post-menu-list" hidden>
        <button type="button" class="post-menu-link post-menu-view">View media</button>
        ${original}
      </div>
    </div>`;
}
function postCardHtml(post) {
  const badge = statusBadge(post);
  const caption = normalizeCaption(post.text || "");
  const layout = pickLayout(post.media);
  const saveControl = saveButtonHtml(post);

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
        ${headerMenuHtml(post)}
      </header>

      ${captionBlockHtml(caption)}
      ${mediaStripHtml(post)}

      <footer class="post-card-foot">
        <div class="post-foot-pills">
          ${post.media
            .slice(0, 3)
            .map((m) => {
              const status = m.saveStatus || "pending";
              return `<span class="pill">${escapeHtml(m.kind)} · ${escapeHtml(status)}</span>`;
            })
            .join("")}
          ${post.media.length === 0 ? `<span class="pill">text</span>` : ""}
        </div>
        ${saveControl ? `<div class="post-foot-actions">${saveControl}</div>` : ""}
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

const saveUnsavedBtn = document.getElementById("saveUnsaved");
let saveUnsavedBusy = false;

function viewingAll() {
  return state.type === "all" && state.user === "all" && !state.q;
}

function unsavedItems(items) {
  return items.filter(
    (item) =>
      item.mediaRecordId &&
      item.kind !== "text" &&
      item.saveStatus !== "saved",
  );
}

function syncSaveUnsavedButton() {
  if (!saveUnsavedBtn || saveUnsavedBusy) return;
  const n = unsavedItems(state.items).length;
  if (viewingAll() && n === 0) {
    saveUnsavedBtn.hidden = true;
    return;
  }
  saveUnsavedBtn.hidden = false;
  saveUnsavedBtn.disabled = false;
  saveUnsavedBtn.textContent =
    viewingAll() && n ? `Save unsaved (${n})` : "Save unsaved";
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
  statusEl.classList.remove("err");
  grid.innerHTML = posts.map(postCardHtml).join("");
  for (const slider of grid.querySelectorAll(".media-slider")) {
    setSliderIndex(slider, Number(slider.dataset.index || 0), { animate: false });
  }
  window.SocialHubMedia?.observeRoot(grid);
  syncSaveUnsavedButton();
}

function keepScroll(run) {
  const x = window.scrollX;
  const y = window.scrollY;
  run();
  window.scrollTo(x, y);
  requestAnimationFrame(() => window.scrollTo(x, y));
}

/** Swap one slide after a retry. Leave scroll position and the carousel index alone. */
function applySavedMedia(mediaRecordId, savedCopy) {
  const item = state.items.find((row) => row.mediaRecordId === mediaRecordId);
  if (item) {
    item.saveStatus = "saved";
    item.savedCopy = savedCopy;
    item.fileUrl = savedCopy;
    if (item.kind === "image") item.previewUrl = savedCopy;
  }
  const cell = grid.querySelector(
    `[data-media="${CSS.escape(mediaRecordId)}"]`,
  );
  const card = cell?.closest(".post-card");
  if (!item) return;

  keepScroll(() => {
    if (!cell || !card) return;
    if (cell) {
      const wrap = document.createElement("div");
      wrap.innerHTML = mediaCellHtml(item, {
        controls: item.kind === "video",
      });
      const next = wrap.firstElementChild;
      if (next) cell.replaceWith(next);
    }

    const post = groupPosts(state.items).find(
      (row) => row.key === card.dataset.post,
    );
    if (!post) return;

    const badge = statusBadge(post);
    const badgeEl = card.querySelector(".post-badge");
    if (badgeEl) {
      badgeEl.className = `post-badge tone-${badge.tone}`;
      badgeEl.textContent = badge.label;
    }

    const pills = card.querySelector(".post-foot-pills");
    if (pills) {
      pills.innerHTML = post.media.length
        ? post.media
            .slice(0, 3)
            .map((m) => {
              const status = m.saveStatus || "pending";
              return `<span class="pill">${escapeHtml(m.kind)} · ${escapeHtml(status)}</span>`;
            })
            .join("")
        : `<span class="pill">text</span>`;
    }

    const saveBtn = card.querySelector(".post-save");
    if (saveBtn && post.media.some((m) => savedCopyOf(m))) {
      saveBtn.disabled = false;
    }

    const head = card.querySelector(".post-card-head");
    const oldMenu = head?.querySelector(
      ":scope > .post-menu, :scope > .post-menu-wrap",
    );
    if (head && oldMenu) {
      const holder = document.createElement("div");
      holder.innerHTML = headerMenuHtml(post);
      const nextMenu = holder.firstElementChild;
      if (nextMenu) oldMenu.replaceWith(nextMenu);
    }
  });
  if (mediaViewState.key === card.dataset.post && mediaView && !mediaView.hidden) {
    renderMediaView();
  }
  syncSaveUnsavedButton();
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

saveUnsavedBtn?.addEventListener("click", async () => {
  if (saveUnsavedBusy) return;
  saveUnsavedBusy = true;
  saveUnsavedBtn.disabled = true;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const hold = () => window.scrollTo(scrollX, scrollY);
  try {
    const res = await fetch("/api/scraps?type=all");
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Failed to list scraps");
    const unsaved = unsavedItems(data.items || []);
    const postIds = [
      ...new Set(unsaved.map((item) => item.postRecordId).filter(Boolean)),
    ];
    if (!postIds.length) {
      saveUnsavedBtn.textContent = "All saved";
      saveUnsavedBtn.hidden = viewingAll();
      return;
    }
    let savedCount = 0;
    let failedCount = 0;
    for (let i = 0; i < postIds.length; i++) {
      saveUnsavedBtn.textContent = `Saving ${i + 1} of ${postIds.length}`;
      hold();
      const saveRes = await fetch("/api/media/save-unsaved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postRecordId: postIds[i] }),
      });
      const saveData = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok || saveData.ok === false) {
        const waiting = unsaved.filter(
          (item) => item.postRecordId === postIds[i],
        ).length;
        failedCount += waiting || 1;
        continue;
      }
      for (const row of saveData.saved || []) {
        applySavedMedia(row.mediaRecordId, row.savedCopy);
        savedCount += 1;
      }
      failedCount += (saveData.failed || []).length;
      hold();
    }
    saveUnsavedBtn.textContent = failedCount
      ? `Saved ${savedCount}, ${failedCount} still waiting`
      : `Saved ${savedCount}`;
  } catch (err) {
    statusEl.textContent = err instanceof Error ? err.message : String(err);
    statusEl.classList.add("err");
    saveUnsavedBtn.textContent = "Save unsaved";
  } finally {
    saveUnsavedBusy = false;
    saveUnsavedBtn.disabled = false;
    hold();
    if (viewingAll() && unsavedItems(state.items).length === 0) {
      saveUnsavedBtn.hidden = true;
    }
  }
});

function flashSaveLabel(btn, text, failed) {
  btn.textContent = text;
  btn.classList.toggle("is-failed", Boolean(failed));
  setTimeout(() => {
    if (btn.dataset.busy === "1") return;
    btn.textContent = "Save";
    btn.classList.remove("is-failed");
  }, 1400);
}

function currentMediaFile(card) {
  const slider = card.querySelector(".media-slider");
  const root = slider
    ? slider.querySelector(".media-slide.is-active")
    : card.querySelector(".post-media") || card.querySelector(".media-view-stage");
  if (!root) return null;
  const video = root.querySelector("video");
  const img = root.querySelector("img.media-el");
  const src =
    video?.currentSrc ||
    video?.getAttribute("src") ||
    img?.currentSrc ||
    img?.getAttribute("src") ||
    "";
  if (!src) return null;
  let name = video ? "video.mp4" : "image.jpg";
  try {
    const base = decodeURIComponent(
      new URL(src, location.href).pathname.split("/").filter(Boolean).pop() ||
        "",
    );
    if (base) name = base;
  } catch (_) {}
  const lower = name.toLowerCase();
  const type = video
    ? lower.endsWith(".webm")
      ? "video/webm"
      : lower.endsWith(".mov")
        ? "video/quicktime"
        : "video/mp4"
    : lower.endsWith(".png")
      ? "image/png"
      : lower.endsWith(".webp")
        ? "image/webp"
        : lower.endsWith(".gif")
          ? "image/gif"
          : "image/jpeg";
  return { src, name, type };
}

function triggerDownload(href, name) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.rel = "noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function saveMediaToDevice(meta) {
  const endpoint = `/api/media/download?url=${encodeURIComponent(meta.src)}`;
  const canTryShare =
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function";
  if (!canTryShare) {
    triggerDownload(endpoint, meta.name);
    return;
  }
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error("Could not fetch media");
  const blob = await res.blob();
  const fileType =
    blob.type && blob.type !== "application/octet-stream" ? blob.type : meta.type;
  const file = new File([blob], meta.name, { type: fileType });
  const shareData = { files: [file], title: "Save media" };
  if (navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      const canceled =
        err?.name === "AbortError" && /cancel/i.test(String(err.message || ""));
      if (canceled) throw err;
    }
  }
  const objectUrl = URL.createObjectURL(blob);
  triggerDownload(objectUrl, meta.name);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}

const mediaView = document.getElementById("mediaView");
let mediaViewState = { key: null, index: 0, scrollX: 0, scrollY: 0 };

function postByKey(key) {
  return groupPosts(state.items).find((row) => row.key === key) || null;
}

function closePostMenus(except) {
  for (const list of document.querySelectorAll(".post-menu-list")) {
    if (except && list === except) continue;
    list.hidden = true;
    list
      .closest(".post-menu-wrap")
      ?.querySelector(".post-menu")
      ?.setAttribute("aria-expanded", "false");
  }
}

function togglePostMenu(menuBtn) {
  const wrap = menuBtn.closest(".post-menu-wrap");
  const list = wrap?.querySelector(".post-menu-list");
  const open = list?.hidden !== false;
  closePostMenus(open ? list : null);
  if (list && open) {
    list.hidden = false;
    menuBtn.setAttribute("aria-expanded", "true");
  }
}

function renderMediaView() {
  if (!mediaView || !mediaViewState.key) return;
  const post = postByKey(mediaViewState.key);
  if (!post || !post.media.length) {
    closeMediaView();
    return;
  }
  const index = Math.max(
    0,
    Math.min(mediaViewState.index, post.media.length - 1),
  );
  mediaViewState.index = index;
  const item = post.media[index];
  const multi = post.media.length > 1;
  const ready = Boolean(savedCopyOf(item));
  const focused = document.activeElement;
  const step = focused?.dataset?.viewStep || "";
  mediaView.innerHTML = `
    <header class="media-view-bar">
      <button type="button" class="media-view-back">Back</button>
      <div class="post-avatar">${avatarHtml(post)}</div>
      <div class="post-identity">
        <span class="post-name">${escapeHtml(post.user)}</span>
        ${
          post.platform
            ? `<span class="post-platform">${escapeHtml(post.platform)}</span>`
            : ""
        }
      </div>
      ${headerMenuHtml(post)}
    </header>
    <div class="media-view-stage">
      ${mediaCellHtml(item, { watch: true })}
    </div>
    <div class="media-view-controls${multi ? " is-multi" : ""}">
      ${
        multi
          ? `<button type="button" class="media-view-nav" data-view-step="-1">Previous</button>
             <span class="media-view-count">${index + 1} / ${post.media.length}</span>`
          : ""
      }
      <button type="button" class="post-save media-view-save"${ready ? "" : " disabled"}>Save</button>
      ${
        multi
          ? `<button type="button" class="media-view-nav" data-view-step="1">Next</button>`
          : ""
      }
    </div>
  `;
  if (step) {
    mediaView.querySelector(`[data-view-step="${step}"]`)?.focus();
  }
}

function openMediaView(post, index) {
  if (!mediaView || !post?.media?.length) return;
  closePostMenus();
  mediaViewState = {
    key: post.key,
    index: Number.isFinite(index) ? index : 0,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
  renderMediaView();
  mediaView.hidden = false;
  document.body.style.overflow = "hidden";
  mediaView.querySelector(".media-view-back")?.focus();
}

function closeMediaView() {
  if (!mediaView || mediaView.hidden) return;
  mediaView.querySelector("video")?.pause();
  mediaView.hidden = true;
  mediaView.innerHTML = "";
  mediaViewState.key = null;
  document.body.style.overflow = rail && !rail.hidden ? "hidden" : "";
  window.scrollTo(mediaViewState.scrollX, mediaViewState.scrollY);
}

function stepMediaView(delta) {
  const post = postByKey(mediaViewState.key);
  if (!post || post.media.length < 2) return;
  const count = post.media.length;
  mediaViewState.index = (mediaViewState.index + delta + count) % count;
  renderMediaView();
}

async function onSaveButton(saveBtn) {
  if (saveBtn.disabled || saveBtn.dataset.busy === "1") return;
  const scope = saveBtn.closest(".media-view") || saveBtn.closest(".post-card");
  const meta = scope ? currentMediaFile(scope) : null;
  if (!meta) {
    flashSaveLabel(saveBtn, "Not ready", true);
    return;
  }
  saveBtn.dataset.busy = "1";
  saveBtn.disabled = true;
  saveBtn.textContent = "Preparing…";
  try {
    await saveMediaToDevice(meta);
    flashSaveLabel(saveBtn, "Saved", false);
  } catch (err) {
    if (err?.name === "AbortError") {
      saveBtn.textContent = "Save";
    } else {
      flashSaveLabel(saveBtn, "Try again", true);
    }
  } finally {
    saveBtn.dataset.busy = "";
    saveBtn.disabled = false;
  }
}

function onLibraryClick(e) {
  const hit = e.target.closest?.(".post-card .media-hit");
  if (hit) {
    e.preventDefault();
    const card = hit.closest(".post-card");
    const slide = hit.closest(".media-slide");
    const index = slide ? Number(slide.dataset.slide || 0) : 0;
    const post = card ? postByKey(card.dataset.post) : null;
    if (post) openMediaView(post, index);
    return true;
  }

  const viewBtn = e.target.closest?.(".post-menu-view");
  if (viewBtn) {
    e.preventDefault();
    const card = viewBtn.closest(".post-card");
    if (!card) {
      closePostMenus();
      return true;
    }
    if (card) {
      const post = postByKey(card.dataset.post);
      const slider = card.querySelector(".media-slider");
      const index = slider ? Number(slider.dataset.index || 0) : 0;
      if (post) openMediaView(post, index);
    }
    return true;
  }

  const menuBtn = e.target.closest?.(".post-menu-wrap .post-menu");
  if (menuBtn) {
    e.preventDefault();
    togglePostMenu(menuBtn);
    return true;
  }

  const menuLink = e.target.closest?.(".post-menu-list a");
  if (menuLink) {
    closePostMenus();
    return false;
  }

  if (!e.target.closest?.(".post-menu-list")) closePostMenus();

  const back = e.target.closest?.(".media-view-back");
  if (back) {
    e.preventDefault();
    closeMediaView();
    return true;
  }

  const stepBtn = e.target.closest?.("[data-view-step]");
  if (stepBtn) {
    e.preventDefault();
    stepMediaView(Number(stepBtn.dataset.viewStep || 0));
    return true;
  }

  const saveBtn = e.target.closest?.(".post-save");
  if (saveBtn) {
    e.preventDefault();
    void onSaveButton(saveBtn);
    return true;
  }

  return false;
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
  if (onLibraryClick(e)) return;

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

const rail = document.getElementById("libRail");
const railBackdrop = document.getElementById("railBackdrop");
const railOpen = document.getElementById("railOpen");
const railClose = document.getElementById("railClose");

mediaView?.addEventListener("click", (e) => {
  onLibraryClick(e);
});

function setRailOpen(open) {
  if (!rail || !railBackdrop || !railOpen) return;
  rail.hidden = !open;
  railBackdrop.hidden = !open;
  railOpen.setAttribute("aria-expanded", open ? "true" : "false");
  document.body.style.overflow =
    open || (mediaView && !mediaView.hidden) ? "hidden" : "";
  if (open) railClose?.focus();
}

railOpen?.addEventListener("click", () => setRailOpen(true));
railClose?.addEventListener("click", () => setRailOpen(false));
railBackdrop?.addEventListener("click", () => setRailOpen(false));
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (mediaView && !mediaView.hidden) {
    closeMediaView();
    return;
  }
  if (rail && !rail.hidden) setRailOpen(false);
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
