import { useEffect } from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { usePrefsStore } from "@/lib/prefs";

function ThemeBridge({ children }: { children: React.ReactNode }) {
  const theme = usePrefsStore((s) => s.theme);
  const { setTheme } = useTheme();

  useEffect(() => {
    setTheme(theme);
  }, [theme, setTheme]);

  return children;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const initial = usePrefsStore.getState().theme;
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={initial}
      enableSystem
      disableTransitionOnChange
      storageKey="social-hub.theme.next"
    >
      <ThemeBridge>{children}</ThemeBridge>
    </NextThemesProvider>
  );
}
