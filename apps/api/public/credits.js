(() => {
  const bar = document.getElementById("creditsBar");
  const panel = document.getElementById("creditsPanel");
  const backdrop = document.getElementById("creditsBackdrop");
  const listEl = document.getElementById("creditsHistory");
  const closeBtn = document.getElementById("creditsClose");
  if (!bar || !panel || !backdrop || !listEl) return;

  let remaining = null;
  let lastCharged = null;
  let historyLoaded = false;

  function fmt(n) {
    if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
    return new Intl.NumberFormat().format(Number(n));
  }

  function paintBar() {
    const charged =
      lastCharged != null
        ? `<span class="credits-chip">charged ${fmt(lastCharged)}</span>`
        : "";
    bar.innerHTML = `${charged}<span class="credits-chip credits-remain">remaining ${fmt(remaining)}</span>`;
    bar.title = "View credit charge history";
    bar.setAttribute("aria-label", `Credits remaining ${fmt(remaining)}. Open charge history.`);
  }

  function setCredits({ remaining: rem, charged } = {}) {
    if (rem != null) remaining = rem;
    if (charged != null) lastCharged = charged;
    paintBar();
  }

  window.setCreditsBar = setCredits;

  function openPanel() {
    panel.hidden = false;
    backdrop.hidden = false;
    bar.setAttribute("aria-expanded", "true");
    if (!historyLoaded) loadHistory();
  }

  function closePanel() {
    panel.hidden = true;
    backdrop.hidden = true;
    bar.setAttribute("aria-expanded", "false");
  }

  function shortRoute(route) {
    return String(route || "")
      .replace(/^\/v\d+\//, "")
      .slice(0, 48);
  }

  function fmtWhen(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  async function loadHistory() {
    listEl.innerHTML = `<p class="muted">Loading history…</p>`;
    try {
      const res = await fetch("/api/credits/history?page=1");
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to load");
      setCredits({ remaining: data.remaining });
      historyLoaded = true;
      const rows = data.history || [];
      if (!rows.length) {
        listEl.innerHTML = `<p class="muted">No recent API charges.</p>`;
        return;
      }
      listEl.innerHTML = `
        <ul class="credits-list">
          ${rows
            .map((r) => {
              const ok = r.success ? "ok" : "warn";
              return `<li class="credits-row">
                <div class="credits-row-main">
                  <span class="credits-route">${escapeHtml(shortRoute(r.route))}</span>
                  <span class="pill ${ok}">${r.credits} cr</span>
                </div>
                <div class="credits-row-meta">
                  <span>${escapeHtml(fmtWhen(r.at))}</span>
                  <span>${r.statusCode}</span>
                  ${r.cacheHit ? `<span class="pill ok">cache</span>` : ""}
                </div>
              </li>`;
            })
            .join("")}
        </ul>`;
    } catch (err) {
      listEl.innerHTML = `<p class="status err">${escapeHtml(err.message || String(err))}</p>`;
    }
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  bar.addEventListener("click", () => {
    if (panel.hidden) openPanel();
    else closePanel();
  });
  backdrop.addEventListener("click", closePanel);
  closeBtn?.addEventListener("click", closePanel);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) closePanel();
  });

  paintBar();
  fetch("/api/credits")
    .then((r) => r.json())
    .then((data) => {
      if (data?.ok) setCredits({ remaining: data.remaining });
    })
    .catch(() => {
      bar.innerHTML = `<span class="credits-chip">credits —</span>`;
    });
})();
