import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fetchJson, fmtNumber, fmtWhen } from "@/lib/api";
import { normalizeCaption } from "@/lib/caption";
import { ExpandableText } from "@/components/expandable-text";
import {
  cacheAgeLabel,
  feedMatches,
  type BatchPost,
  type FeedFilter,
  type Platform,
  useBatchStore,
} from "@/lib/batch-store";

const PLATFORM_LABEL: Record<Platform, string> = {
  x: "X",
  instagram: "Instagram",
  tiktok: "TikTok",
};

const EXAMPLE: Record<Platform, string> = {
  x: "elonmusk",
  instagram: "natgeo",
  tiktok: "stoolpresidente",
};

type Parsed = {
  platform?: Platform;
  handle: string;
  tip: string;
  error?: boolean;
  fromUrl?: boolean;
};

function parseProfileInput(raw: string): Parsed {
  const input = String(raw || "").trim();
  if (!input) {
    return {
      handle: "",
      tip: "Paste a profile link or type a username — platform is detected for you.",
    };
  }

  const looksLikeUrl =
    /^https?:\/\//i.test(input) ||
    /(?:^|\.)(?:x|twitter|instagram|instagr|tiktok)\.com\b/i.test(input) ||
    /^[\w.-]+\.[a-z]{2,}\//i.test(input);

  if (looksLikeUrl) {
    try {
      const withProto = /^https?:\/\//i.test(input) ? input : `https://${input}`;
      const u = new URL(withProto);
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      const parts = u.pathname.split("/").filter(Boolean);

      if (
        host === "x.com" ||
        host === "twitter.com" ||
        host === "mobile.twitter.com"
      ) {
        const skip = new Set([
          "i",
          "home",
          "explore",
          "search",
          "intent",
          "share",
          "hashtag",
        ]);
        let handle = parts[0] || "";
        if (
          handle.toLowerCase() === "intent" &&
          u.searchParams.get("screen_name")
        ) {
          handle = u.searchParams.get("screen_name") || "";
        }
        handle = handle.replace(/^@/, "");
        if (handle && !skip.has(handle.toLowerCase())) {
          return {
            platform: "x",
            handle,
            tip: `Detected X profile → @${handle}.`,
            fromUrl: true,
          };
        }
      }

      if (host === "instagram.com" || host === "instagr.am") {
        const skip = new Set([
          "p",
          "reel",
          "reels",
          "tv",
          "stories",
          "explore",
          "accounts",
        ]);
        let handle = parts[0] || "";
        if (skip.has(handle.toLowerCase())) {
          return {
            handle: "",
            tip: "That looks like a post link. Paste a profile URL.",
            error: true,
          };
        }
        handle = handle.replace(/^@/, "");
        if (handle) {
          return {
            platform: "instagram",
            handle,
            tip: `Detected Instagram → @${handle}.`,
            fromUrl: true,
          };
        }
      }

      if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
        let handle = parts[0] || "";
        if (handle.startsWith("@")) handle = handle.slice(1);
        const skip = new Set([
          "foryou",
          "following",
          "live",
          "search",
          "tag",
          "music",
          "video",
        ]);
        if (parts[0] === "video" || parts.includes("video")) {
          return {
            handle: "",
            tip: "That looks like a video link. Paste a profile URL.",
            error: true,
          };
        }
        if (handle && !skip.has(handle.toLowerCase())) {
          return {
            platform: "tiktok",
            handle,
            tip: `Detected TikTok → @${handle}.`,
            fromUrl: true,
          };
        }
      }
    } catch {
      /* fall through */
    }
  }

  const handle = input.replace(/^@/, "").split(/[/?#\s]/)[0] || "";
  return {
    handle,
    tip: handle
      ? `Will fetch @${handle} on the selected platform.`
      : "Enter a username.",
  };
}

type ProgressRow = {
  id: string;
  label: string;
  state: "pending" | "run" | "ok" | "err";
  pct: number;
};

export function BatchPage() {
  const platform = useBatchStore((s) => s.platform);
  const handle = useBatchStore((s) => s.handle);
  const filter = useBatchStore((s) => s.filter);
  const posts = useBatchStore((s) => s.posts);
  const note = useBatchStore((s) => s.note);
  const selectedIds = useBatchStore((s) => s.selectedIds);
  const recentHandles = useBatchStore((s) => s.recentHandles);
  const statusMessage = useBatchStore((s) => s.statusMessage);
  const fetchedAt = useBatchStore((s) => s.fetchedAt);
  const setPlatform = useBatchStore((s) => s.setPlatform);
  const setHandle = useBatchStore((s) => s.setHandle);
  const setFilter = useBatchStore((s) => s.setFilter);
  const setFeed = useBatchStore((s) => s.setFeed);
  const clearSearch = useBatchStore((s) => s.clearSearch);
  const setStatusMessage = useBatchStore((s) => s.setStatusMessage);
  const toggleSelected = useBatchStore((s) => s.toggleSelected);
  const selectAll = useBatchStore((s) => s.selectAll);
  const deselectAll = useBatchStore((s) => s.deselectAll);
  const pushRecent = useBatchStore((s) => s.pushRecent);

  const [input, setInput] = useState(handle);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [statusErr, setStatusErr] = useState(false);

  const parsed = useMemo(() => parseProfileInput(input), [input]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const hasSavedSearch = posts.length > 0 && Boolean(handle);
  const cached =
    Boolean(parsed.handle) &&
    feedMatches(platform, parsed.handle, filter, {
      platform,
      handle,
      filter,
      posts,
    }) &&
    hasSavedSearch;

  async function onFetch(e: React.FormEvent) {
    e.preventDefault();
    if (!parsed.handle || parsed.error) {
      setStatusErr(true);
      setStatusMessage(parsed.tip || "Enter a valid username or profile URL.");
      return;
    }
    const nextPlatform = parsed.platform || platform;
    if (parsed.platform) setPlatform(parsed.platform);
    setHandle(parsed.handle);
    setInput(parsed.handle);
    setLoading(true);
    setStatusErr(false);
    setProgress([]);
    setStatusMessage(
      `Fetching @${parsed.handle} on ${PLATFORM_LABEL[nextPlatform]}…`,
    );

    try {
      const qs = new URLSearchParams({
        platform: nextPlatform,
        handle: parsed.handle,
        limit: "24",
        filter,
      });
      const data = await fetchJson<{
        ok: boolean;
        error?: string;
        handle?: string;
        posts?: BatchPost[];
        note?: string;
      }>(`/api/recent-posts?${qs}`);
      pushRecent(nextPlatform, data.handle || parsed.handle);
      setFeed({
        platform: nextPlatform,
        handle: data.handle || parsed.handle,
        filter,
        posts: data.posts || [],
        note: data.note || null,
      });
      setStatusMessage(
        `Showing ${(data.posts || []).length} posts for ${data.handle || parsed.handle}.`,
      );
      toast.success("Feed loaded");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusErr(true);
      setStatusMessage(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function onDownload() {
    const ids = [...selected];
    if (!ids.length) return;
    const byId = new Map(posts.map((p) => [String(p.id), p]));
    setDownloading(true);
    setProgress(
      ids.map((id) => ({
        id,
        label: (byId.get(id)?.caption || byId.get(id)?.url || id).slice(0, 48),
        state: "pending" as const,
        pct: 0,
      })),
    );
    setStatusMessage(`Downloading ${ids.length} selected post(s)…`);

    async function scrapeOnce(url: string) {
      await fetchJson<{ ok: boolean; error?: string }>("/api/scrape-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, saveToR2: true }),
      });
    }

    let okCount = 0;
    let failCount = 0;

    for (const id of ids) {
      const post = byId.get(id);
      const patch = (row: Partial<ProgressRow>) =>
        setProgress((prev) =>
          prev.map((p) => (p.id === id ? { ...p, ...row } : p)),
        );

      if (!post?.url) {
        patch({ state: "err", label: "Missing URL", pct: 100 });
        failCount++;
        continue;
      }

      patch({ state: "run", label: "Scraping…", pct: 20 });
      try {
        try {
          await scrapeOnce(post.url);
        } catch {
          patch({ state: "run", label: "Retrying…", pct: 40 });
          await scrapeOnce(post.url);
        }
        patch({ state: "ok", label: "Saved", pct: 100 });
        okCount++;
      } catch (err) {
        patch({
          state: "err",
          label: err instanceof Error ? err.message : "Failed",
          pct: 100,
        });
        failCount++;
      }
    }

    setStatusMessage(`Done · ${okCount} saved · ${failCount} failed`);
    setDownloading(false);
    if (okCount) toast.success(`${okCount} saved`);
    if (failCount) toast.error(`${failCount} failed`);
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <form onSubmit={onFetch} className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-[10rem_1fr_auto]">
          <div className="space-y-2">
            <Label>Platform</Label>
            <Select
              value={platform}
              onValueChange={(v) => setPlatform(v as Platform)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="x">X</SelectItem>
                <SelectItem value="instagram">Instagram</SelectItem>
                <SelectItem value="tiktok">TikTok</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="handle">Handle or profile URL</Label>
            <Input
              id="handle"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={EXAMPLE[platform]}
              autoComplete="off"
            />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={loading || downloading}>
              {loading ? "Fetching…" : cached ? "Refresh posts" : "Fetch posts"}
            </Button>
            {hasSavedSearch ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  clearSearch();
                  setInput("");
                  setProgress([]);
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Filter</Label>
          <ToggleGroup
            type="single"
            value={filter}
            onValueChange={(v) => {
              if (v) setFilter(v as FeedFilter);
            }}
            variant="outline"
          >
            <ToggleGroupItem value="media">Media</ToggleGroupItem>
            <ToggleGroupItem value="original">Original</ToggleGroupItem>
            <ToggleGroupItem value="all">All</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <p
          className={
            parsed.error
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
        >
          {parsed.tip}
          {hasSavedSearch
            ? ` · Cached ${cacheAgeLabel({ fetchedAt }) || ""}`
            : ""}
        </p>

        {recentHandles.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {recentHandles.map((r) => (
              <Button
                key={`${r.platform}:${r.handle}`}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  setPlatform(r.platform);
                  setHandle(r.handle);
                  setInput(r.handle);
                }}
              >
                {PLATFORM_LABEL[r.platform]} @{r.handle}
              </Button>
            ))}
          </div>
        ) : null}
      </form>

      {statusMessage ? (
        <p
          className={
            statusErr
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
        >
          {statusMessage}
        </p>
      ) : null}
      {note ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          {note}
        </p>
      ) : null}

      {posts.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={selectAll}>
              Select all
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={deselectAll}
            >
              Deselect
            </Button>
            <span className="text-sm text-muted-foreground">
              {selected.size} selected
            </span>
            <Button
              type="button"
              size="sm"
              className="ml-auto"
              disabled={!selected.size || downloading}
              onClick={() => void onDownload()}
            >
              {downloading ? "Saving…" : "Save selected → R2"}
            </Button>
          </div>

          <div className="grid gap-3">
            {posts.map((p) => {
              const slides = Number(p.mediaCount) || 0;
              const typeLabel =
                slides > 1
                  ? "Carousel"
                  : p.mediaType === "video" || p.mediaType === "gif"
                    ? "Video"
                    : p.mediaType === "text"
                      ? "Text"
                      : "Image";
              const checked = selected.has(String(p.id));
              const thumb = p.thumbnail || p.previewUrl;
              return (
                <Card
                  key={p.id}
                  className="cursor-pointer transition-colors hover:bg-accent/40"
                  onClick={() => toggleSelected(String(p.id))}
                >
                  <CardContent className="flex gap-3 p-3">
                    <div
                      className="pt-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleSelected(String(p.id))}
                        aria-label="Select post"
                      />
                    </div>
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md bg-muted">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
                          {typeLabel}
                        </div>
                      )}
                      {slides > 1 ? (
                        <Badge className="absolute bottom-1 left-1 text-[10px]">
                          {slides}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <strong>@{p.handle || handle}</strong>
                        <span className="text-muted-foreground">
                          {fmtWhen(p.postedAt)}
                        </span>
                        <Badge variant="outline">{typeLabel}</Badge>
                      </div>
                      <ExpandableText
                        text={normalizeCaption(p.caption)}
                        empty="(no caption)"
                        lines={2}
                        maxChars={140}
                        className="text-sm text-muted-foreground"
                      />
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>{fmtNumber(p.likes)} likes</span>
                        {p.views != null ? (
                          <span>{fmtNumber(p.views)} views</span>
                        ) : null}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      ) : null}

      {progress.length > 0 ? (
        <ul className="space-y-2 rounded-xl border border-border bg-card p-3 text-sm">
          {progress.map((row) => (
            <li key={row.id} className="space-y-1">
              <div className="flex justify-between gap-2">
                <span className="truncate font-medium">
                  {(posts.find((p) => String(p.id) === row.id)?.caption ||
                    row.id
                  ).slice(0, 48)}
                </span>
                <span
                  className={
                    row.state === "err"
                      ? "text-destructive"
                      : row.state === "ok"
                        ? "text-primary"
                        : "text-muted-foreground"
                  }
                >
                  {row.state === "pending"
                    ? "Queued"
                    : row.state === "run"
                      ? row.label
                      : row.state === "ok"
                        ? "Saved"
                        : row.label}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${row.pct}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
