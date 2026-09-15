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
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return "—";
  }
}

function previewHtml(item) {
  if (item.kind === "video") {
    const src = item.fileUrl || item.previewUrl;
    if (!src) return `<div class="scrap-ph">No video</div>`;
    return `<video class="scrap-media" controls playsinline preload="metadata" src="${escapeAttr(src)}" poster="${escapeAttr(item.previewUrl || "")}"></video>`;
  }
  if (item.kind === "image") {
    const src = item.previewUrl || item.fileUrl;
    if (!src) return `<div class="scrap-ph">No image</div>`;
    return `<img class="scrap-media" src="${escapeAttr(src)}" alt="" loading="lazy" />`;
  }
  const text = item.text || "(empty)";
  return `<div class="scrap-text"><p>${escapeHtml(text.slice(0, 420))}${text.length > 420 ? "…" : ""}</p></div>`;
}

function cardHtml(item) {
  return `
    <article class="scrap-card kind-${escapeAttr(item.kind)}">
      <div class="scrap-preview">${previewHtml(item)}</div>
      <div class="scrap-meta">
        <div class="scrap-top">
          <span class="pill">${escapeHtml(item.kind)}</span>
          ${item.fileStatus ? `<span class="pill">${escapeHtml(item.fileStatus)}</span>` : ""}
        </div>
        <p class="scrap-user">${escapeHtml(item.user)}${item.platform ? ` · ${escapeHtml(item.platform)}` : ""}</p>
        <p class="scrap-when">${escapeHtml(fmtWhen(item.savedAt))}</p>
        ${
          item.postLink
            ? `<a class="scrap-link" href="${escapeAttr(item.postLink)}" target="_blank" rel="noreferrer">Open original</a>`
            : ""
        }
      </div>
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

function render() {
  updateTabCounts();
  if (!state.items.length) {
    grid.innerHTML = "";
    empty.hidden = false;
    statusEl.textContent = "0 scraps";
    return;
  }
  empty.hidden = true;
  statusEl.textContent = `${state.items.length} scrap${state.items.length === 1 ? "" : "s"}`;
  grid.innerHTML = state.items.map(cardHtml).join("");
}

async function load() {
  statusEl.textContent = "Loading scraps…";
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
