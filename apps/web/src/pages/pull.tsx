import { useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { fetchJson, fmtNumber, hiResAvatar } from "@/lib/api";
import { normalizeCaption } from "@/lib/caption";
import { ExpandableText } from "@/components/expandable-text";

type ScrapeResult = {
  ok: boolean;
  error?: string;
  platform?: string;
  saveMode?: string;
  cached?: boolean;
  creditsRemaining?: number;
  creditsCharged?: number;
  profile?: {
    name?: string;
    handle?: string;
    avatar?: string;
  };
  post?: {
    id?: string;
    text?: string;
    status?: string;
    likes?: number;
    views?: number;
    repostKind?: string;
    quotedHandle?: string;
    postType?: string;
  };
  media?: Array<{
    id?: string;
    type?: string;
    order?: number;
    savedCopy?: string;
    fileLink?: string;
    previewLink?: string;
  }>;
};

export function PullPage() {
  const [url, setUrl] = useState("");
  const [saveR2, setSaveR2] = useState(true);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [result, setResult] = useState<ScrapeResult | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    setLoading(true);
    setResult(null);
    setError(false);
    setStatus("Pulling… scrape → Airtable → R2. Large videos can take a minute.");

    try {
      const data = await fetchJson<ScrapeResult>("/api/scrape-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed, saveToR2: saveR2 }),
      });
      setResult(data);
      if (!data.profile?.handle || data.profile.handle === "@unknown") {
        setError(true);
        setStatus(
          "Scrape returned incomplete profile data. Hard-refresh and try again.",
        );
      } else {
        setStatus(
          `Done · Airtable post ${data.post?.id || "—"}${
            data.media?.[0]?.id ? ` · media ${data.media[0].id}` : ""
          }`,
        );
      }
      toast.success("Post pulled");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(true);
      setStatus(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  const mediaSorted = [...(result?.media || [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  const caption = normalizeCaption(result?.post?.text);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <p className="text-sm font-medium text-primary">Social Hub</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">
          Paste a post. Watch it land.
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Instagram, TikTok, or X — scrape → Airtable → your R2 copy.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="space-y-2">
          <Label htmlFor="url">Media link</Label>
          <Input
            id="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            autoComplete="off"
            className="h-11"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Switch id="saveR2" checked={saveR2} onCheckedChange={setSaveR2} />
            <Label htmlFor="saveR2">Save copy to R2</Label>
          </div>
          <Button type="submit" disabled={loading || !url.trim()}>
            {loading ? "Pulling…" : "Pull"}
          </Button>
        </div>
      </form>

      {status ? (
        <p
          className={
            error
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
        >
          {status}
        </p>
      ) : null}

      {result?.ok ? (
        <div className="grid gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Profile</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-3">
              <Avatar className="size-12">
                <AvatarImage
                  src={hiResAvatar(result.profile?.avatar)}
                  alt=""
                />
                <AvatarFallback>
                  {(result.profile?.handle || "?").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="font-medium">
                  {result.profile?.name || result.profile?.handle || "Unknown"}
                </div>
                <div className="text-sm text-muted-foreground">
                  {result.profile?.handle} · {result.platform}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">Post</CardTitle>
                <Badge variant="secondary">{result.post?.status || "ok"}</Badge>
                {result.saveMode ? (
                  <Badge variant="outline">{result.saveMode}</Badge>
                ) : null}
                {result.cached ? <Badge>cache hit</Badge> : null}
              </div>
              <div className="pt-2">
                <ExpandableText
                  text={caption || ""}
                  empty="(no caption)"
                  className="text-sm text-foreground"
                />
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3 text-sm text-muted-foreground">
              <span>{fmtNumber(result.post?.likes)} likes</span>
              {result.post?.views != null ? (
                <span>{fmtNumber(result.post.views)} views</span>
              ) : null}
            </CardContent>
          </Card>

          {mediaSorted.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Media ({mediaSorted.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {mediaSorted.map((m, i) => {
                  const src = m.savedCopy || m.fileLink || m.previewLink;
                  const video =
                    m.type === "video" || m.type === "gif";
                  return (
                    <div
                      key={m.id || i}
                      className="overflow-hidden rounded-lg border border-border bg-muted/40"
                    >
                      {src ? (
                        video ? (
                          <video
                            controls
                            playsInline
                            className="aspect-square w-full object-cover"
                            src={src}
                            poster={m.previewLink}
                          />
                        ) : (
                          <img
                            src={src}
                            alt=""
                            className="aspect-square w-full object-cover"
                          />
                        )
                      ) : (
                        <div className="flex aspect-square items-center justify-center text-sm text-muted-foreground">
                          No preview
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
