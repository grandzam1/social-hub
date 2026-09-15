import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExpandableText } from "@/components/expandable-text";
import { useMediaAutoplay } from "@/hooks/use-media-autoplay";
import { displayHandle, fetchJson, fmtWhen, hiResAvatar } from "@/lib/api";
import { normalizeCaption } from "@/lib/caption";
import { cn } from "@/lib/utils";

type ScrapKind = "text" | "image" | "video";

type ScrapItem = {
  id: string;
  kind: ScrapKind;
  text?: string;
  previewUrl?: string;
  fileUrl?: string;
  user: string;
  avatarUrl?: string;
  platform?: string;
  postLink?: string;
  postRecordId?: string;
  savedAt: string;
  fileStatus?: string;
  order?: number;
};

type ScrapsResponse = {
  ok: boolean;
  items?: ScrapItem[];
  users?: string[];
  counts?: { all: number; text: number; image: number; video: number };
  error?: string;
};

type ScrapPost = {
  key: string;
  user: string;
  avatarUrl: string;
  platform: string;
  postLink: string;
  savedAt: string;
  text: string;
  media: ScrapItem[];
};

function groupPosts(items: ScrapItem[]): ScrapPost[] {
  const map = new Map<string, ScrapPost>();
  for (const item of items) {
    const key = item.postRecordId || item.id;
    if (!map.has(key)) {
      map.set(key, {
        key,
        user: item.user || "unknown",
        avatarUrl: item.avatarUrl || "",
        platform: item.platform || "",
        postLink: item.postLink || "",
        savedAt: item.savedAt || "",
        text: item.text || "",
        media: [],
      });
    }
    const g = map.get(key)!;
    if (item.user) g.user = item.user;
    if (item.avatarUrl) g.avatarUrl = item.avatarUrl;
    if (item.platform) g.platform = item.platform;
    if (item.postLink) g.postLink = item.postLink;
    if (item.text) g.text = item.text;
    if (item.savedAt && (!g.savedAt || item.savedAt > g.savedAt)) {
      g.savedAt = item.savedAt;
    }
    const hasFile = Boolean(item.fileUrl || item.previewUrl);
    if (item.kind === "text" && !hasFile) continue;
    if (item.kind === "image" || item.kind === "video") {
      g.media.push(item);
    }
  }
  const posts = [...map.values()];
  for (const p of posts) {
    p.media.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  posts.sort(
    (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
  );
  return posts;
}

function statusBadge(post: ScrapPost) {
  const statuses = post.media.map((m) => m.fileStatus).filter(Boolean);
  if (statuses.some((s) => /saved copy ready/i.test(String(s)))) {
    return { label: "Saved", tone: "default" as const };
  }
  if (statuses.some((s) => /file link ready/i.test(String(s)))) {
    return { label: "File link ready", tone: "secondary" as const };
  }
  if (post.media.length === 0) {
    return { label: "Text", tone: "outline" as const };
  }
  return {
    label: statuses[0] || post.media[0]?.kind || "Media",
    tone: "outline" as const,
  };
}

function KindTag({ kind }: { kind: ScrapKind }) {
  if (kind === "text") return null;
  return (
    <span className="pointer-events-none absolute bottom-2 left-2 z-[1] rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
      {kind}
    </span>
  );
}

function MediaSlide({
  item,
  className,
}: {
  item: ScrapItem;
  className?: string;
}) {
  const src = item.previewUrl || item.fileUrl || "";
  const open = item.fileUrl || item.previewUrl || "";
  const frame = cn(
    "relative flex h-full w-full items-center justify-center overflow-hidden bg-muted",
    className,
  );

  if (!src) {
    return (
      <div className={frame}>
        <span className="text-sm text-muted-foreground">
          File link ready — waiting for saved copy
        </span>
      </div>
    );
  }

  if (item.kind === "video") {
    const videoSrc =
      item.fileUrl ||
      (/\.(mp4|mov|webm|m4v|m3u8)(\?|#|$)/i.test(src) ? src : "") ||
      "";
    const poster =
      item.previewUrl &&
      !/\.(mp4|mov|webm|m4v|m3u8)(\?|#|$)/i.test(item.previewUrl)
        ? item.previewUrl
        : undefined;
    if (!videoSrc) {
      return (
        <div className={frame}>
          <span className="text-sm text-muted-foreground">
            File link ready — waiting for saved copy
          </span>
        </div>
      );
    }
    return (
      <div className={frame}>
        <video
          className="max-h-full max-w-full object-contain"
          data-media-video
          data-force-controls="1"
          playsInline
          muted
          preload="metadata"
          controls
          poster={poster}
          src={videoSrc}
        />
        <KindTag kind="video" />
      </div>
    );
  }

  const img = (
    <img
      src={src}
      alt=""
      loading="lazy"
      className="h-full w-full object-cover"
    />
  );

  return (
    <div className={frame}>
      {open ? (
        <a
          href={open}
          target="_blank"
          rel="noreferrer"
          className="block h-full w-full"
        >
          {img}
        </a>
      ) : (
        img
      )}
      <KindTag kind="image" />
    </div>
  );
}

function MediaCarousel({ media }: { media: ScrapItem[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const count = media.length;

  const syncIndex = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const slides = [...el.querySelectorAll<HTMLElement>("[data-slide]")];
    if (!slides.length) return;
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;
    slides.forEach((slide, i) => {
      const center = slide.offsetLeft + slide.offsetWidth / 2;
      const dist = Math.abs(center - mid);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    setIndex(best);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    syncIndex();
    el.addEventListener("scroll", syncIndex, { passive: true });
    window.addEventListener("resize", syncIndex);
    return () => {
      el.removeEventListener("scroll", syncIndex);
      window.removeEventListener("resize", syncIndex);
    };
  }, [syncIndex, media]);

  function scrollTo(i: number) {
    const slide = scrollerRef.current?.querySelectorAll<HTMLElement>(
      "[data-slide]",
    )[i];
    slide?.scrollIntoView({
      behavior: "smooth",
      inline: "start",
      block: "nearest",
    });
  }

  function step(dir: -1 | 1) {
    scrollTo(Math.max(0, Math.min(count - 1, index + dir)));
  }

  return (
    <div className="group/media relative -mx-4">
      <div
        ref={scrollerRef}
        className={cn(
          "flex h-full snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain",
          "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          "px-4 py-0.5",
        )}
      >
        {media.map((m, i) => (
          <div
            key={m.id}
            data-slide={i}
            className="relative w-[min(100%,22rem)] shrink-0 snap-start sm:w-[85%]"
          >
            <div className="overflow-hidden rounded-2xl ring-1 ring-foreground/10">
              <MediaSlide
                item={m}
                className="aspect-[16/10] max-h-[22rem] sm:max-h-[26rem]"
              />
            </div>
            {i === index ? (
              <span className="pointer-events-none absolute top-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white backdrop-blur-sm">
                {index + 1}/{count}
              </span>
            ) : null}
          </div>
        ))}
        <div className="w-4 shrink-0 snap-none" aria-hidden />
      </div>

      {index > 0 ? (
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="absolute top-1/2 left-2 z-10 size-9 -translate-y-1/2 border-0 bg-black/45 text-white shadow-none backdrop-blur-sm hover:bg-black/60 hover:text-white md:opacity-0 md:group-hover/media:opacity-100"
          onClick={() => step(-1)}
          aria-label="Previous slide"
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
      ) : null}
      {index < count - 1 ? (
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="absolute top-1/2 right-2 z-10 size-9 -translate-y-1/2 border-0 bg-black/45 text-white shadow-none backdrop-blur-sm hover:bg-black/60 hover:text-white md:opacity-0 md:group-hover/media:opacity-100"
          onClick={() => step(1)}
          aria-label="Next slide"
        >
          <ChevronRightIcon className="size-4" />
        </Button>
      ) : null}

      <div className="mt-2 flex justify-center gap-1.5 px-4">
        {media.map((m, i) => (
          <button
            key={m.id}
            type="button"
            aria-label={`Go to slide ${i + 1}`}
            className={cn(
              "size-1.5 rounded-full transition-all",
              i === index
                ? "w-3.5 bg-primary"
                : "bg-muted-foreground/35 hover:bg-muted-foreground/55",
            )}
            onClick={() => scrollTo(i)}
          />
        ))}
      </div>
    </div>
  );
}

function ScrapCard({ post }: { post: ScrapPost }) {
  const caption = normalizeCaption(post.text);
  const badge = statusBadge(post);
  const pills =
    post.media.length === 0
      ? ["text"]
      : post.media.slice(0, 3).map((m) =>
          m.fileStatus ? `${m.kind} · ${m.fileStatus}` : m.kind,
        );

  async function copyCaption() {
    if (!caption) return;
    try {
      await navigator.clipboard.writeText(caption);
      toast.success("Caption copied");
    } catch {
      toast.error("Could not copy");
    }
  }

  return (
    <Card
      className="gap-3 overflow-hidden rounded-[1.25rem] py-4 ring-1 ring-foreground/10"
      data-platform={post.platform || undefined}
      data-post={post.key}
    >
      <CardHeader className="flex flex-row items-start gap-3 space-y-0 px-4 py-0">
        <Avatar className="size-10 rounded-xl">
          <AvatarImage
            src={hiResAvatar(post.avatarUrl)}
            alt=""
            className="rounded-xl"
          />
          <AvatarFallback className="rounded-xl text-xs font-medium">
            {displayHandle(post.user).slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[0.98rem] font-bold tracking-tight">
              @{displayHandle(post.user)}
            </span>
            <Badge
              variant={badge.tone}
              className="h-auto rounded-full px-2.5 py-0.5 font-mono text-[0.68rem] font-normal tracking-wide"
            >
              {badge.label}
            </Badge>
            <time
              className="font-mono text-[0.72rem] text-muted-foreground"
              dateTime={post.savedAt}
            >
              {fmtWhen(post.savedAt)}
            </time>
          </div>
          {post.platform ? (
            <div className="mt-0.5 font-mono text-[0.68rem] lowercase text-muted-foreground">
              {post.platform}
            </div>
          ) : null}
        </div>

        {post.postLink ? (
          <a
            href={post.postLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Open original"
            title="Open original"
          >
            <MoreHorizontalIcon className="size-4" />
          </a>
        ) : (
          <span
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground/40"
            aria-hidden
          >
            <MoreHorizontalIcon className="size-4" />
          </span>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-3 px-4 py-0">
        {caption ? (
          <div className="flex items-start gap-2.5">
            <div className="min-w-0 flex-1">
              <ExpandableText
                text={caption}
                className="text-[1.02rem] leading-[1.45] tracking-tight"
                maxChars={520}
                lines={8}
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-auto shrink-0 rounded-full border-border px-2.5 py-2 font-mono text-[0.72rem] text-muted-foreground hover:text-foreground"
              onClick={() => void copyCaption()}
            >
              Copy
            </Button>
          </div>
        ) : null}

        {post.media.length === 0 ? null : post.media.length === 1 ? (
          <div className="overflow-hidden rounded-2xl ring-1 ring-foreground/10">
            <MediaSlide
              item={post.media[0]}
              className="aspect-[16/10] max-h-[26rem]"
            />
          </div>
        ) : (
          <MediaCarousel media={post.media} />
        )}
      </CardContent>

      <CardFooter className="mt-auto flex items-center justify-between gap-3 border-t border-border/60 px-4 pt-3 pb-0">
        <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 font-mono text-[0.72rem]">
          {pills.map((pill) => (
            <span key={pill} className="text-muted-foreground">
              {pill.includes(" · ") ? (
                <>
                  <span className="text-foreground/85">
                    {pill.split(" · ")[0]}
                  </span>
                  <span className="text-primary/90">
                    {" · "}
                    {pill.split(" · ").slice(1).join(" · ")}
                  </span>
                </>
              ) : (
                pill
              )}
            </span>
          ))}
        </div>
        {post.postLink ? (
          <a
            href={post.postLink}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Open original
          </a>
        ) : null}
      </CardFooter>
    </Card>
  );
}

export function ScrapsPage() {
  const [type, setType] = useState("all");
  const [user, setUser] = useState("all");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ScrapItem[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [counts, setCounts] = useState({
    all: 0,
    text: 0,
    image: 0,
    video: 0,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  useMediaAutoplay(rootRef);

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (type !== "all") params.set("type", type);
    if (user !== "all") params.set("user", user);
    if (qDebounced) params.set("q", qDebounced);
    const qs = params.toString();
    try {
      const data = await fetchJson<ScrapsResponse>(
        qs ? `/api/scraps?${qs}` : "/api/scraps",
      );
      setItems(data.items || []);
      setUsers((data.users || []).filter(Boolean));
      setCounts(data.counts || { all: 0, text: 0, image: 0, video: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [type, user, qDebounced]);

  useEffect(() => {
    void load();
  }, [load]);

  // Retry when the tab becomes visible again (e.g. API was started after first load).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && error) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [error, load]);

  const posts = useMemo(() => groupPosts(items), [items]);

  return (
    <div ref={rootRef} className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 md:flex-row md:items-end md:justify-between md:p-4">
        <div className="space-y-2">
          <Label>Type</Label>
          <Tabs value={type} onValueChange={setType}>
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
              <TabsTrigger value="image">Images ({counts.image})</TabsTrigger>
              <TabsTrigger value="video">Videos ({counts.video})</TabsTrigger>
              <TabsTrigger value="text">Text ({counts.text})</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="grid w-full gap-3 sm:grid-cols-2 md:max-w-md">
          <div className="space-y-2">
            <Label htmlFor="userFilter">User</Label>
            <Select value={user} onValueChange={setUser}>
              <SelectTrigger id="userFilter" className="w-full">
                <SelectValue placeholder="All users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                {users.map((u) => {
                  const handle = displayHandle(u);
                  return (
                    <SelectItem key={handle} value={handle}>
                      @{handle}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="search">Search captions</Label>
            <Input
              id="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter…"
            />
          </div>
        </div>
      </div>

      {error ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <span className="min-w-0 flex-1">{error}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void load()}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-80 w-full rounded-[1.25rem]" />
          <Skeleton className="h-72 w-full rounded-[1.25rem]" />
        </div>
      ) : posts.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground">
          No scraps match these filters.
        </p>
      ) : posts.length === 0 ? null : (
        <div className="flex flex-col gap-4">
          {posts.map((post) => (
            <ScrapCard key={post.key} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
