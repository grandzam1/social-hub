/**
 * Media playback prefs — shared only on pages that show video.
 * Persists in localStorage; default autoplay OFF (mobile-friendly).
 */
(function () {
  const KEY = "social-hub.media.v1";
  const listeners = new Set();
  let observer = null;

  function read() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
      return {
        autoplay: Boolean(raw.autoplay),
      };
    } catch {
      return { autoplay: false };
    }
  }

  function write(partial) {
    const next = { ...read(), ...partial };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch (_) {}
    for (const fn of listeners) {
      try {
        fn(next);
      } catch (_) {}
    }
    applyAll();
    return next;
  }

  function getAutoplay() {
    return read().autoplay;
  }

  function setAutoplay(on) {
    return write({ autoplay: Boolean(on) });
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function prepVideo(video, autoplay) {
    if (!(video instanceof HTMLVideoElement)) return;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    if (autoplay) {
      video.dataset.autoplayOn = "1";
      video.loop = true;
      video.removeAttribute("controls");
    } else {
      delete video.dataset.autoplayOn;
      video.loop = false;
      video.pause();
      video.controls = video.dataset.forceControls === "1";
    }
  }

  function syncInView(entries) {
    const autoplay = getAutoplay();
    for (const entry of entries) {
      const video = entry.target;
      if (!(video instanceof HTMLVideoElement)) continue;
      prepVideo(video, autoplay);
      if (!autoplay) continue;
      if (entry.isIntersecting && entry.intersectionRatio >= 0.45) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    }
  }

  function ensureObserver() {
    if (observer || typeof IntersectionObserver === "undefined") return observer;
    observer = new IntersectionObserver(syncInView, {
      threshold: [0, 0.45, 0.75],
      rootMargin: "40px 0px",
    });
    return observer;
  }

  function observeRoot(root) {
    const scope = root || document;
    const autoplay = getAutoplay();
    const obs = ensureObserver();
    for (const video of scope.querySelectorAll("video[data-media-video]")) {
      prepVideo(video, autoplay);
      if (obs) obs.observe(video);
      else if (autoplay) video.play().catch(() => {});
    }
  }

  function applyAll() {
    observeRoot(document);
  }

  function bindToggle(input) {
    if (!input) return;
    input.checked = getAutoplay();
    input.addEventListener("change", () => {
      setAutoplay(input.checked);
    });
    subscribe((prefs) => {
      if (input.checked !== prefs.autoplay) input.checked = prefs.autoplay;
    });
  }

  window.SocialHubMedia = {
    getAutoplay,
    setAutoplay,
    subscribe,
    observeRoot,
    applyAll,
    bindToggle,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => applyAll());
  } else {
    applyAll();
  }
})();
