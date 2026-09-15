const form = document.getElementById("form");
const urlInput = document.getElementById("url");
const saveR2 = document.getElementById("saveR2");
const go = document.getElementById("go");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");

function fmt(n) {
  if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat().format(Number(n));
}

function fmtDuration(ms, sec) {
  const s = sec != null ? Number(sec) : ms != null ? Number(ms) / 1000 : null;
  if (s == null || Number.isNaN(s)) return null;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${r}s`;
}

function setStatus(text, isErr = false) {
  statusEl.hidden = !text;
  statusEl.textContent = text || "";
  statusEl.classList.toggle("err", Boolean(isErr));
}

function mediaPreview(m) {
  const src = m.savedCopy || m.fileLink || m.previewLink;
  if (!src) return `<p class="muted">No preview URL</p>`;
  if (m.type === "video" || m.type === "gif") {
    return `<video controls playsinline src="${escapeAttr(src)}" poster="${escapeAttr(m.previewLink || "")}"></video>`;
  }
  return `<img src="${escapeAttr(src)}" alt="Media preview" />`;
}

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

function avatarHtml(profile) {
  if (profile.avatar) {
    const hi = String(profile.avatar).replace("_normal.", "_400x400.");
    return `<img src="${escapeAttr(hi)}" alt="" />`;
  }
  return `<div class="avatar-fallback" aria-hidden="true"></div>`;
}

function render(data) {
  const mediaSorted = [...(data.media || [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  const savedAll =
    mediaSorted.length && mediaSorted.every((m) => m.savedCopy);
  const statusPill = savedAll
    ? `<span class="pill ok">Saved</span>`
    : `<span class="pill warn">${escapeHtml(data.post?.status || "unknown")}</span>`;
  const modePill =
    data.saveMode === "async"
      ? `<span class="pill warn">R2 queue (carousel)</span>`
      : data.saveMode === "sync"
        ? `<span class="pill">R2 sync</span>`
        : `<span class="pill">CDN only</span>`;
  const repostPill = data.post?.repostKind
    ? `<span class="pill warn">${data.post.repostKind === "retweet" ? "Retweet" : "Quote"} ${escapeHtml(data.post.quotedHandle || "")}</span>`
    : data.post?.postType
      ? `<span class="pill">${escapeHtml(data.post.postType)}</span>`
      : "";

  const displayName =
    data.profile?.name || data.profile?.handle || "Unknown account";
  const handle = data.profile?.handle || "@unknown";

  resultEl.hidden = false;
  resultEl.innerHTML = `
    <article class="card">
      <h2>Profile</h2>
      <div class="profile">
        ${avatarHtml(data.profile || {})}
        <div class="meta">
          <strong>${escapeHtml(displayName)}</strong>
          <span>${escapeHtml(handle)} · ${escapeHtml(data.platform || "")}</span>
        </div>
      </div>
    </article>

    <article class="card">
      <h2>Post</h2>
      <p class="caption">${escapeHtml(data.post?.text || "(no caption)")}</p>
      <div class="stats">
        ${statusPill}
        ${modePill}
        ${repostPill}
        <span class="pill">slides ${fmt(data.post?.mediaCount ?? mediaSorted.length)}</span>
        <span class="pill">likes ${fmt(data.post?.likes)}</span>
        <span class="pill">comments ${fmt(data.post?.comments)}</span>
        <span class="pill">shares ${fmt(data.post?.shares)}</span>
        <span class="pill">views ${fmt(data.post?.views)}</span>
        ${
          data.post?.durationSec != null
            ? `<span class="pill">length ${escapeHtml(fmtDuration(null, data.post.durationSec))}</span>`
            : ""
        }
        <span class="pill">${escapeHtml(data.post?.postId || "")}</span>
      </div>
      <div class="links" style="margin-top:12px">
        <a href="${escapeAttr(data.post?.link)}" target="_blank" rel="noreferrer">Open original</a>
      </div>
    </article>

    <article class="card">
      <h2>Media · ${mediaSorted.length} <span class="muted-inline">(Order 0…n)</span></h2>
      ${
        !mediaSorted.length
          ? `<p class="muted">No media extracted from this post. Try a post that has a photo or video (not a profile link).</p>`
          : `<div class="media-grid">${mediaSorted
              .map((m) => {
                const dims =
                  m.width && m.height ? `${m.width}×${m.height}` : null;
                const dur = fmtDuration(m.durationMs, null);
                return `
          <div class="media-item">
            <div class="slide-label">Slide ${escapeHtml(String(m.order ?? 0))}</div>
            ${mediaPreview(m)}
            <div class="stats">
              <span class="pill">${escapeHtml(m.type)}</span>
              ${dims ? `<span class="pill">${escapeHtml(dims)}</span>` : ""}
              ${dur ? `<span class="pill">${escapeHtml(dur)}</span>` : ""}
              <span class="pill ${m.savedCopy ? "ok" : "warn"}">${escapeHtml(m.fileStatus)}</span>
            </div>
            <div class="links">
              <div>CDN: <a href="${escapeAttr(m.fileLink)}" target="_blank" rel="noreferrer">File link</a></div>
              ${
                m.savedCopy
                  ? `<div>R2: <a href="${escapeAttr(m.savedCopy)}" target="_blank" rel="noreferrer">Saved copy</a></div>`
                  : `<div>R2: ${data.saveMode === "async" ? "queued…" : "not saved yet"}</div>`
              }
            </div>
          </div>`;
              })
              .join("")}</div>`
      }
    </article>

    ${
      data.cached
        ? `<article class="card"><div class="stats"><span class="pill ok">cache hit</span></div></article>`
        : ""
    }
  `;

  if (typeof window.setCreditsBar === "function") {
    window.setCreditsBar({
      remaining: data.creditsRemaining,
      charged: data.creditsCharged ?? 0,
    });
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  go.disabled = true;
  resultEl.hidden = true;
  setStatus("Pulling… scrape → Airtable → R2. Large videos can take a minute.");

  try {
    const res = await fetch("/api/scrape-post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        saveToR2: saveR2.checked,
        // omit saveMode → API uses sync for 1 file, async batch for carousels
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    if (!data.profile?.handle || data.profile.handle === "@unknown") {
      setStatus(
        "Scrape returned incomplete profile data. Hard-refresh the page (Ctrl+Shift+R) and try again.",
        true,
      );
    } else {
      setStatus(
        `Done · Airtable post ${data.post.id}${
          data.media?.[0]?.id ? ` · media ${data.media[0].id}` : ""
        }`,
      );
    }
    render(data);
  } catch (err) {
    setStatus(err.message || String(err), true);
  } finally {
    go.disabled = false;
  }
});
