import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

const THEME_KEY = "social-hub.theme";
const MEDIA_KEY = "social-hub.media.v1";

export type ThemePref = "light" | "dark" | "system";

type PrefsState = {
  theme: ThemePref;
  autoplay: boolean;
  setTheme: (theme: ThemePref) => void;
  setAutoplay: (autoplay: boolean) => void;
};

function readLegacyTheme(): ThemePref {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === "light" || t === "dark") return t;
  } catch {
    /* ignore */
  }
  return "system";
}

function readLegacyAutoplay(): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem(MEDIA_KEY) || "{}") as {
      autoplay?: boolean;
    };
    return Boolean(raw.autoplay);
  } catch {
    return false;
  }
}

function syncLegacyTheme(theme: ThemePref) {
  try {
    if (theme === "system") {
      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } else {
      localStorage.setItem(THEME_KEY, theme);
    }
  } catch {
    /* ignore */
  }
}

function syncLegacyMedia(autoplay: boolean) {
  try {
    localStorage.setItem(MEDIA_KEY, JSON.stringify({ autoplay }));
  } catch {
    /* ignore */
  }
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      theme: readLegacyTheme(),
      autoplay: readLegacyAutoplay(),
      setTheme: (theme) => {
        syncLegacyTheme(theme);
        set({ theme });
      },
      setAutoplay: (autoplay) => {
        syncLegacyMedia(autoplay);
        set({ autoplay });
      },
    }),
    {
      name: "social-hub.prefs.v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ theme: s.theme, autoplay: s.autoplay }),
    },
  ),
);
