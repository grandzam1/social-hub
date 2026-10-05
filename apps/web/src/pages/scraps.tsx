import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExpandableText } from "@/components/expandable-text";
import { useMediaAutoplay } from "@/hooks/use-media-autoplay";
import { displayHandle, fetchJson, fmtWhen, hiResAvatar } from "@/lib/api";
import { normalizeCaption } from "@/lib/caption";
import { usePrefsStore } from "@/lib/prefs";
import { DownloadProgress } from "@/components/download-progress";
import {
  downloadPercent,
  downloadWithProgress,
  overallDownloadPercent,
  saveBlobToDevice,
  type DownloadStatus,
} from "@/lib/download-file";
import { cn } from "@/lib/utils";

const FEED_PAGE_SIZE = 15;

type ScrapKind = "text" | "image" | "video";

type SaveStatus = "pending" | "saved" | "failed";

type ScrapItem = {
  id: string;
  kind: ScrapKind;
  text?: string;
  previewUrl?: string;
  fileUrl?: string;
  savedCopy?: string;
  saveStatus?: SaveStatus;
  user: string;
  avatarUrl?: string;
  platform?: string;
  postLink?: string;
  postRecordId?: string;
  mediaRecordId?: string;
  savedAt: string;
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
    if (item.kind === "text") continue;
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
  const statuses = post.media.map((m) => m.saveStatus).filter(Boolean);
  if (statuses.length && statuses.every((s) => s === "saved")) {
    return { label: "Saved", tone: "default" as const };
  }
  if (statuses.some((s) => s === "failed")) {
    return { label: "Failed", tone: "destructive" as const };
  }
  if (statuses.some((s) => s === "pending")) {
    return { label: "Pending", tone: "secondary" as const };
  }
  if (post.media.length === 0) {
    return { label: "Text", tone: "outline" as const };
  }
  return {
    label: post.media[0]?.kind || "Media",
    tone: "outline" as const,
  };
}

function savedHref(item: ScrapItem) {
  if (item.saveStatus !== "saved") return "";
  return item.savedCopy || item.fileUrl || "";
}

function fileNameFromUrl(url: string, kind: ScrapKind) {
  try {
    const base = decodeURIComponent(
      new URL(url).pathname.split("/").filter(Boolean).pop() || "",
    );
    if (base) return base;
  } catch {
    /* keep the fallback name */
  }
  return kind === "video" ? "video.mp4" : "image.jpg";
}

function mimeFor(name: string, kind: ScrapKind) {
  const lower = name.toLowerCase();
  if (kind === "video") {
    if (lower.endsWith(".webm")) return "video/webm";
    if (lower.endsWith(".mov")) return "video/quicktime";
    return "video/mp4";
  }
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

/** Media already sent to the device during this visit. */
const savedToDevice = new Set<string>();

function mediaKey(item: ScrapItem, index: number) {
  return item.mediaRecordId || item.id || String(index);
}

function uniqueFileName(name: string, used: Set<string>) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let n = 2;
  let next = `${stem}-${n}${ext}`;
  while (used.has(next)) {
    n += 1;
    next = `${stem}-${n}${ext}`;
  }
  used.add(next);
  return next;
}

function canShareFiles() {
  return (
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function"
  );
}

function downloadEndpoint(url: string) {
  return `/api/media/download?url=${encodeURIComponent(url)}`;
}

function fileFromBlob(blob: Blob, kind: ScrapKind, name: string) {
  const type =
    blob.type && blob.type !== "application/octet-stream"
      ? blob.type
      : mimeFor(name, kind);
  return new File([blob], name, { type });
}

async function deliverBlob(blob: Blob, kind: ScrapKind, name: string, share: boolean) {
  if (!share || !canShareFiles()) {
    saveBlobToDevice(blob, name);
    return;
  }
  const file = fileFromBlob(blob, kind, name);
  const shareData = { files: [file], title: "Save media" };
  if (navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      const canceled =
        err instanceof DOMException &&
        err.name === "AbortError" &&
        /cancel/i.test(err.message);
      if (canceled) throw err;
    }
  }
  saveBlobToDevice(file, name);
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
  onRetry,
  onOpen,
  watch = false,
}: {
  item: ScrapItem;
  className?: string;
  onRetry?: (mediaRecordId: string) => void;
  onOpen?: () => void;
  watch?: boolean;
}) {
  const autoplay = usePrefsStore((s) => s.autoplay);
  const feedAutoplay = autoplay && !watch;
  const src = savedHref(item);
  const frame = cn(
    "relative flex h-full w-full items-center justify-center overflow-hidden bg-muted",
    className,
  );
  const status = item.saveStatus || "pending";

  if (status === "failed") {
    return (
      <div className={frame}>
        <div className="flex flex-col items-center gap-2 px-4 text-center">
          <span className="text-sm text-muted-foreground">Save failed</span>
          {item.mediaRecordId && onRetry ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => onRetry(item.mediaRecordId!)}
            >
              Retry save
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (status !== "saved" || !src) {
    return (
      <div className={frame}>
        <div className="flex flex-col items-center gap-2 px-4 text-center">
          <span className="text-sm text-muted-foreground">
            Waiting for saved copy
          </span>
          {item.mediaRecordId && onRetry ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => onRetry(item.mediaRecordId!)}
            >
              Retry save
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (item.kind === "video") {
    return (
      <div className={frame}>
          <video
            className="max-h-full max-w-full bg-black object-contain"
            {...(watch ? {} : { "data-media-video": "" })}
            data-force-controls="1"
            playsInline
            muted={watch ? undefined : true}
            preload="metadata"
            loop={feedAutoplay}
            controls={!feedAutoplay}
            poster={item.previewUrl || undefined}
            src={src}
          />
        <KindTag kind="video" />
      </div>
    );
  }

  const image = (
    <img
      src={src}
      alt=""
      loading="lazy"
      className={cn(
        "h-full w-full",
        watch ? "object-contain" : "object-cover",
      )}
    />
  );

  return (
    <div className={frame}>
      {onOpen && !watch ? (
        <button
          type="button"
          className="block h-full w-full cursor-pointer"
          aria-label="View media"
          onClick={onOpen}
        >
          {image}
        </button>
      ) : (
        image
      )}
      <KindTag kind="image" />
    </div>
  );
}

function PostMenu({
  post,
  onView,
  triggerClassName,
  contentClassName,
}: {
  post: ScrapPost;
  onView: () => void;
  triggerClassName?: string;
  contentClassName?: string;
}) {
  const triggerClass = cn(
    "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
    triggerClassName,
  );

  if (post.media.length === 0) {
    return (
      <span
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground/40"
        aria-hidden
      >
        <MoreHorizontalIcon className="size-4" />
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={triggerClass}
        aria-label="Post actions"
        title="Post actions"
      >
        <MoreHorizontalIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={cn("min-w-40", contentClassName)}>
        <DropdownMenuItem
          onSelect={() => {
            onView();
          }}
        >
          View media
        </DropdownMenuItem>
        {post.postLink ? (
          <DropdownMenuItem asChild>
            <a href={post.postLink} target="_blank" rel="noreferrer">
              Open original
            </a>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type SaveRowStatus =
  | "not-ready"
  | "already"
  | "queued"
  | DownloadStatus;

type SaveRow = {
  id: string;
  label: string;
  status: SaveRowStatus;
  percent: number;
  total: number;
};

type SingleTransfer = {
  status: DownloadStatus;
  label: string;
  percent: number;
  total: number;
};

function planSaveRows(media: ScrapItem[]): SaveRow[] {
  const seenUrls = new Set<string>();
  return media.map((item, index) => {
    const src = savedHref(item);
    const id = mediaKey(item, index);
    const label = `${item.kind} ${index + 1}`;
    const blank = { id, label, percent: 0, total: 0 };
    if (!src) return { ...blank, status: "not-ready" as const };
    const duplicate = seenUrls.has(src);
    seenUrls.add(src);
    if (savedToDevice.has(id) || duplicate) {
      return { ...blank, status: "already" as const };
    }
    return { ...blank, status: "queued" as const };
  });
}

function rowStatusText(row: SaveRow): string {
  if (row.status === "not-ready") return "Not ready";
  if (row.status === "already") return "Already saved";
  if (row.status === "queued") return "Queued";
  if (row.status === "preparing") return "Preparing download…";
  if (row.status === "downloading") {
    return row.total > 0 ? `Downloading… ${row.percent}%` : "Downloading…";
  }
  if (row.status === "saving") return "Saving to device…";
  if (row.status === "done") return "Saved";
  return "Download failed";
}

function kindWord(kind: ScrapKind) {
  if (kind === "video") return "video";
  if (kind === "image") return "image";
  return kind;
}

function SaveMediaButton({
  media,
  className,
}: {
  media: ScrapItem[];
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SaveRow[]>([]);
  const [transfer, setTransfer] = useState<SingleTransfer | null>(null);
  const saveAction = usePrefsStore((s) => s.saveAction);
  const many = media.length > 1;
  const single = media[0];
  const singleSrc = single ? savedHref(single) : "";
  const canSave = many
    ? media.some((item) => Boolean(savedHref(item)))
    : Boolean(singleSrc);

  function patchRow(id: string, patch: Partial<SaveRow>) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }

  async function transferItem(
    item: ScrapItem,
    src: string,
    name: string,
    onUpdate: (patch: { status: DownloadStatus; percent: number; total: number }) => void,
  ) {
    onUpdate({ status: "preparing", percent: 0, total: 0 });
    const blob = await downloadWithProgress(downloadEndpoint(src), (loaded, total) => {
      onUpdate({
        status: "downloading",
        percent: downloadPercent(loaded, total) ?? 0,
        total,
      });
    });
    onUpdate({
      status: "saving",
      percent: blob.size > 0 ? 100 : 0,
      total: blob.size > 0 ? blob.size : 0,
    });
    await deliverBlob(blob, item.kind, name, saveAction === "share" && item.kind !== "video");
    onUpdate({ status: "done", percent: 100, total: 1 });
  }

  async function saveOne() {
    if (!single || !singleSrc || busy) return;
    setBusy(true);
    const word = kindWord(single.kind);
    setTransfer({
      status: "preparing",
      label: "Preparing download…",
      percent: 0,
      total: 0,
    });
    try {
      await transferItem(single, singleSrc, fileNameFromUrl(singleSrc, single.kind), (patch) => {
        setTransfer((current) => {
          const status = patch.status ?? current?.status ?? "downloading";
          const total = patch.total ?? current?.total ?? 0;
          const percent = patch.percent ?? current?.percent ?? 0;
          const label =
            status === "preparing"
              ? "Preparing download…"
              : status === "downloading"
                ? `Downloading ${word}…`
                : status === "saving"
                  ? "Saving to device…"
                  : "Saved";
          return { status, label, percent, total };
        });
      });
      savedToDevice.add(mediaKey(single, 0));
      setTransfer({ status: "done", label: "Saved", percent: 100, total: 1 });
      window.setTimeout(() => setTransfer(null), 1400);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setTransfer(null);
      } else {
        setTransfer({
          status: "failed",
          label: "Download failed",
          percent: 0,
          total: 0,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveQueue(
    queue: Array<{ row: SaveRow; item: ScrapItem }>,
  ) {
    const names = new Set<string>();
    let activeId = "";
    try {
      for (const entry of queue) {
        const src = savedHref(entry.item);
        if (!src) continue;
        activeId = entry.row.id;
        const name = uniqueFileName(fileNameFromUrl(src, entry.item.kind), names);
        await transferItem(entry.item, src, name, (patch) => patchRow(entry.row.id, patch));
        savedToDevice.add(entry.row.id);
        activeId = "";
      }
    } catch (err) {
      const canceled = err instanceof DOMException && err.name === "AbortError";
      setRows((current) =>
        current.map((row) => {
          if (!canceled && row.id === activeId) {
            return { ...row, status: "failed", percent: 0, total: 0 };
          }
          if (
            row.status === "preparing" ||
            row.status === "downloading" ||
            row.status === "saving"
          ) {
            return { ...row, status: "queued", percent: 0, total: 0 };
          }
          return row;
        }),
      );
    }
  }

  async function saveAll() {
    if (busy) return;
    const planned = rows.length ? rows : planSaveRows(media);
    if (!rows.length) setRows(planned);
    const queue = planned
      .map((row, index) => ({ row, item: media[index]! }))
      .filter((entry) => entry.row.status === "queued" || entry.row.status === "failed");
    if (!queue.length) return;
    setBusy(true);
    try {
      await saveQueue(queue);
    } finally {
      setBusy(false);
    }
  }

  async function retryRow(id: string) {
    if (busy) return;
    const index = rows.findIndex((row) => row.id === id);
    const item = media[index];
    const row = rows[index];
    if (!item || !row) return;
    setBusy(true);
    try {
      await saveQueue([{ row, item }]);
    } finally {
      setBusy(false);
    }
  }

  function onClick() {
    if (!canSave || busy) return;
    if (many) {
      setRows(planSaveRows(media));
      setOpen(true);
      return;
    }
    void saveOne();
  }

  const work = rows.filter(
    (row) => row.status !== "not-ready" && row.status !== "already",
  );
  const readyCount = work.filter(
    (row) => row.status === "queued" || row.status === "failed",
  ).length;
  const savedCount = work.filter((row) => row.status === "done").length;
  const activeIndex = work.findIndex(
    (row) =>
      row.status === "preparing" ||
      row.status === "downloading" ||
      row.status === "saving",
  );
  const active = activeIndex >= 0 ? work[activeIndex] : undefined;
  const activePercent =
    active && active.total > 0
      ? active.status === "saving"
        ? 100
        : active.percent
      : active
        ? null
        : 0;
  const overall = overallDownloadPercent(savedCount, activePercent, work.length);
  const filePosition = active ? activeIndex + 1 : Math.min(savedCount + 1, work.length);
  const countLine = busy
    ? `Saving ${filePosition} of ${work.length || media.length}`
    : savedCount
      ? `Saved ${savedCount} of ${work.length}`
      : `${media.length} files in this post`;

  return (
    <>
      {transfer && !many ? (
        <div className="w-56 max-w-full">
          <DownloadProgress
            status={transfer.status}
            percent={transfer.percent}
            total={transfer.total}
            label={transfer.label}
            onRetry={transfer.status === "failed" ? () => void saveOne() : undefined}
          />
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className={cn("h-11 min-w-[4.5rem] rounded-full", className)}
          disabled={!canSave || busy}
          onClick={onClick}
        >
          Save
        </Button>
      )}
      {many ? (
        <Sheet
          open={open}
          onOpenChange={(next) => {
            if (busy) return;
            setOpen(next);
          }}
        >
          <SheetContent
            side="bottom"
            overlayClassName="z-[80]"
            className="z-[80] mx-auto max-h-[min(70dvh,32rem)] w-full max-w-md gap-0 overflow-hidden rounded-t-2xl border"
          >
            <SheetHeader>
              <SheetTitle>Save all media?</SheetTitle>
              <SheetDescription>
                {countLine}. Files already saved are skipped.
              </SheetDescription>
            </SheetHeader>
            {active ? (
              <div className="space-y-3 px-4 pb-2">
                <DownloadProgress
                  status={
                    active.status === "downloading" ||
                    active.status === "saving" ||
                    active.status === "preparing"
                      ? active.status
                      : "preparing"
                  }
                  percent={active.percent}
                  total={active.total}
                  label={
                    active.status === "downloading"
                      ? `Downloading ${active.label}…`
                      : active.status === "saving"
                        ? "Saving to device…"
                        : active.status === "failed"
                          ? "Download failed"
                          : "Preparing download…"
                  }
                />
                <DownloadProgress
                  status="downloading"
                  percent={overall ?? 0}
                  total={overall == null ? 0 : 1}
                  label={overall == null ? "Overall" : "Overall:"}
                />
              </div>
            ) : null}
            <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto px-4" aria-live="polite">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 font-mono text-xs"
                >
                  <span className="capitalize text-foreground">{row.label}</span>
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-muted-foreground",
                        row.status === "done" && "text-foreground",
                        row.status === "failed" && "text-destructive",
                        (row.status === "downloading" || row.status === "saving") &&
                          "text-foreground",
                      )}
                    >
                      {rowStatusText(row)}
                    </span>
                    {row.status === "failed" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void retryRow(row.id)}
                      >
                        Retry
                      </Button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <SheetFooter className="flex-row justify-end">
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="rounded-full"
                disabled={busy || readyCount === 0}
                onClick={() => void saveAll()}
              >
                {busy ? "Saving…" : "Save All"}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}

function MediaCarousel({
  media,
  onRetry,
  onOpen,
  onIndexChange,
}: {
  media: ScrapItem[];
  onRetry?: (mediaRecordId: string) => void;
  onOpen?: (index: number) => void;
  onIndexChange?: (index: number) => void;
}) {
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
    onIndexChange?.(best);
  }, [onIndexChange]);

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
                onRetry={onRetry}
                onOpen={onOpen ? () => onOpen(i) : undefined}
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

function ScrapCard({
  post,
  onRetry,
  onView,
}: {
  post: ScrapPost;
  onRetry?: (mediaRecordId: string) => void;
  onView: (index: number) => void;
}) {
  const caption = normalizeCaption(post.text);
  const badge = statusBadge(post);
  const [slideIndex, setSlideIndex] = useState(0);
  const pills =
    post.media.length === 0
      ? ["text"]
      : post.media.slice(0, 3).map((m) => `${m.kind} · ${m.saveStatus || "pending"}`);

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

        <PostMenu post={post} onView={() => onView(slideIndex)} />
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
              onRetry={onRetry}
              onOpen={() => onView(0)}
            />
          </div>
        ) : (
          <MediaCarousel
            media={post.media}
            onRetry={onRetry}
            onOpen={onView}
            onIndexChange={setSlideIndex}
          />
        )}
      </CardContent>

      <CardFooter className="mt-auto flex items-center justify-between gap-3 border-t border-border/60 px-4 pt-3 pb-0">
        <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 font-mono text-[0.72rem]">
          {pills.map((pill, i) => (
            <span key={`${pill}-${i}`} className="text-muted-foreground">
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
        {post.media.length ? <SaveMediaButton media={post.media} /> : null}
      </CardFooter>
    </Card>
  );
}

function MediaView({
  post,
  index,
  onIndex,
  onClose,
}: {
  post: ScrapPost;
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const count = post.media.length;
  const safeIndex = Math.max(0, Math.min(index, Math.max(count - 1, 0)));
  const item = post.media[safeIndex];
  const multi = count > 1;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  if (!item) return null;

  function step(dir: -1 | 1) {
    onIndex((safeIndex + dir + count) % count);
  }

  const controlClass =
    "h-11 rounded-full border-white/25 bg-transparent text-[#f3ebe0] hover:bg-white/10 hover:text-[#f3ebe0]";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#120e0b] text-[#f3ebe0]"
      role="dialog"
      aria-modal="true"
      aria-label="Media"
    >
      <header className="flex items-center gap-3 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        <Button type="button" variant="outline" className={controlClass} onClick={onClose}>
          Back
        </Button>
        <Avatar className="size-10 rounded-xl">
          <AvatarImage src={hiResAvatar(post.avatarUrl)} alt="" className="rounded-xl" />
          <AvatarFallback className="rounded-xl text-xs">
            {displayHandle(post.user).slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">@{displayHandle(post.user)}</div>
          {post.platform ? (
            <div className="font-mono text-xs lowercase text-[#c9b8a0]">
              {post.platform}
            </div>
          ) : null}
        </div>
        <PostMenu
          post={post}
          onView={() => onIndex(safeIndex)}
          triggerClassName="text-[#f3ebe0] hover:bg-white/10 hover:text-[#f3ebe0]"
          contentClassName="z-[70]"
        />
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center px-3">
        <MediaSlide
          item={item}
          watch
          className="h-full max-h-[calc(100dvh-10.5rem)] w-full max-w-3xl bg-transparent"
        />
      </div>
      <div
        className={cn(
          "flex flex-wrap items-center gap-3 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]",
          multi ? "justify-between" : "justify-center",
        )}
      >
        {multi ? (
          <Button type="button" variant="outline" className={controlClass} onClick={() => step(-1)}>
            Previous
          </Button>
        ) : null}
        {multi ? (
          <span className="order-first w-full text-center font-mono text-xs text-[#c9b8a0] sm:order-none sm:w-auto">
            {safeIndex + 1} / {count}
          </span>
        ) : null}
        <SaveMediaButton media={post.media} className={controlClass} />
        {multi ? (
          <Button type="button" variant="outline" className={controlClass} onClick={() => step(1)}>
            Next
          </Button>
        ) : null}
      </div>
    </div>,
    document.body,
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
  const [visibleCount, setVisibleCount] = useState(FEED_PAGE_SIZE);
  const visiblePosts = posts.slice(0, visibleCount);
  const hiddenCount = Math.max(0, posts.length - visiblePosts.length);

  useEffect(() => {
    setVisibleCount(FEED_PAGE_SIZE);
  }, [type, user, qDebounced]);
  const [view, setView] = useState<{ key: string; index: number } | null>(null);
  const viewPost = view ? posts.find((post) => post.key === view.key) ?? null : null;

  const retrySave = useCallback(
    async (mediaRecordId: string) => {
      try {
        await fetchJson("/api/media/save-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mediaRecordId,
            mediaOnly: true,
            force: true,
          }),
        });
        toast.success("Saved to R2");
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [load],
  );

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
          {visiblePosts.map((post) => (
            <ScrapCard
              key={post.key}
              post={post}
              onRetry={(mediaRecordId) => void retrySave(mediaRecordId)}
              onView={(index) => setView({ key: post.key, index })}
            />
          ))}
          {hiddenCount > 0 ? (
            <Button
              type="button"
              variant="outline"
              className="self-center rounded-full"
              onClick={() => setVisibleCount((count) => count + FEED_PAGE_SIZE)}
            >
              Load more
            </Button>
          ) : null}
        </div>
      )}
      {view && viewPost ? (
        <MediaView
          post={viewPost}
          index={view.index}
          onIndex={(index) => setView({ key: viewPost.key, index })}
          onClose={() => setView(null)}
        />
      ) : null}
    </div>
  );
}
