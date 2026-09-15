/** Theme toggle — persists in localStorage across pages. */
(function () {
  const KEY = "social-hub.theme";

  function current() {
    const t = document.documentElement.getAttribute("data-theme");
    return t === "dark" ? "dark" : "light";
  }

  function apply(theme) {
    const next = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(KEY, next);
    } catch (_) {}
    syncButton();
  }

  function syncButton() {
    const btn = document.getElementById("themeToggle");
    if (!btn) return;
    const dark = current() === "dark";
    btn.setAttribute("aria-pressed", dark ? "true" : "false");
    btn.setAttribute(
      "aria-label",
      dark ? "Switch to light theme" : "Switch to dark theme",
    );
    btn.dataset.theme = dark ? "dark" : "light";
    const label = btn.querySelector(".theme-toggle-label");
    if (label) label.textContent = dark ? "Light" : "Dark";
  }

  function boot() {
    // Head script may have already set data-theme; still sync UI.
    const saved = (() => {
      try {
        return localStorage.getItem(KEY);
      } catch (_) {
        return null;
      }
    })();
    if (saved === "dark" || saved === "light") apply(saved);
    else syncButton();

    document.getElementById("themeToggle")?.addEventListener("click", () => {
      apply(current() === "dark" ? "light" : "dark");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
