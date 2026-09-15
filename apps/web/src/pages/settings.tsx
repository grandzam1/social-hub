import { useTheme } from "next-themes";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePrefsStore, type ThemePref } from "@/lib/prefs";

export function SettingsPage() {
  const autoplay = usePrefsStore((s) => s.autoplay);
  const theme = usePrefsStore((s) => s.theme);
  const setAutoplay = usePrefsStore((s) => s.setAutoplay);
  const setPrefTheme = usePrefsStore((s) => s.setTheme);
  const { setTheme } = useTheme();

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            Theme preference syncs with the legacy{" "}
            <code className="text-xs">social-hub.theme</code> key.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="theme">Theme</Label>
          <Select
            value={theme}
            onValueChange={(v) => {
              const next = v as ThemePref;
              setPrefTheme(next);
              setTheme(next);
            }}
          >
            <SelectTrigger id="theme" className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Media</CardTitle>
          <CardDescription>
            Autoplay is off by default. When on, in-view videos play muted and
            looped on Scraps.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="autoplay">Autoplay videos</Label>
            <Switch
              id="autoplay"
              checked={autoplay}
              onCheckedChange={setAutoplay}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
