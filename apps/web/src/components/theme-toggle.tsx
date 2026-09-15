import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { usePrefsStore } from "@/lib/prefs";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const setPrefTheme = usePrefsStore((s) => s.setTheme);

  const dark = resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => {
        const next = dark ? "light" : "dark";
        setTheme(next);
        setPrefTheme(next);
      }}
    >
      {dark ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
    </Button>
  );
}
