import { useCallback, useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson } from "@/lib/api";
import { cn } from "@/lib/utils";

type ServiceUsage = {
  service: string;
  unit: "credits" | "requests" | "bytes";
  given: number | null;
  used: number | null;
  remaining: number | null;
  source: string;
};

type UsageResponse = {
  ok: boolean;
  configured: boolean;
  warning?: string;
  creditsWarning?: string;
  services: ServiceUsage[];
  error?: string;
};

function fmtValue(n: number | null, unit: ServiceUsage["unit"]) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (unit === "bytes") {
    if (!n) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i += 1;
    }
    return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
  }
  const label =
    unit === "credits" ? "credits" : unit === "requests" ? "requests" : "";
  return `${n.toLocaleString()} ${label}`.trim();
}

function StatusDot({
  tone,
}: {
  tone: "live" | "tracked" | "idle";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        tone === "live" && "bg-emerald-500",
        tone === "tracked" && "bg-sky-500",
        tone === "idle" && "bg-muted-foreground/40",
      )}
    />
  );
}

function UsageIndicator({
  given,
  used,
  remaining,
}: {
  given: number | null;
  used: number | null;
  remaining: number | null;
}) {
  // Quota-backed: used vs remaining against a known given amount.
  if (given != null && given > 0 && used != null && remaining != null) {
    const pctUsed = Math.min(100, Math.max(0, (used / given) * 100));
    const pctLeft = Math.min(100, Math.max(0, (remaining / given) * 100));

    return (
      <div className="space-y-1.5">
        <div
          className="flex h-2.5 overflow-hidden rounded-full bg-muted"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={given}
          aria-valuenow={remaining}
          aria-label="Remaining"
        >
          <div
            className="bg-primary/85 transition-[width]"
            style={{ width: `${pctUsed}%` }}
            title="Used"
          />
          <div
            className="bg-primary/25 transition-[width]"
            style={{ width: `${pctLeft}%` }}
            title="Remaining"
          />
        </div>
        <p className="font-mono text-[11px] text-muted-foreground">
          {Math.round(pctLeft)}% remaining
        </p>
      </div>
    );
  }

  // No vendor quota (Airtable / R2): show a used-only activity indicator.
  if (used == null) return null;

  const active = used > 0;

  return (
    <div className="space-y-1.5">
      <div
        className="flex h-2.5 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={active ? used : 1}
        aria-valuenow={used}
        aria-label="Used"
      >
        <div
          className={cn(
            "transition-[width]",
            active ? "w-full bg-sky-500/80" : "w-0 bg-transparent",
          )}
          title="Used"
        />
      </div>
      <p className="font-mono text-[11px] text-muted-foreground">
        {active ? "Usage recorded · no quota" : "No usage recorded"}
      </p>
    </div>
  );
}

function ServiceCard({ row }: { row: ServiceUsage }) {
  const hasBalance =
    row.given != null || row.remaining != null || row.used != null;
  const isLive = row.source === "scrapecreators";
  const hasUsed = row.used != null && row.used > 0;
  const tone = isLive ? "live" : hasUsed ? "tracked" : "idle";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <StatusDot tone={tone} />
            {row.service}
          </CardTitle>
          <Badge variant="secondary" className="font-normal">
            {isLive ? "Live" : "Tracked"}
          </Badge>
        </div>
        <CardDescription className="text-xs">
          {isLive
            ? "Live balance from ScrapeCreators; used from their usage log"
            : "Recorded in usage_events (no vendor quota available)"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasBalance ? (
          <p className="text-sm text-muted-foreground">No data yet.</p>
        ) : (
          <>
            <dl className="grid gap-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">Given</dt>
                <dd className="font-mono tabular-nums">
                  {fmtValue(row.given, row.unit)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">Used</dt>
                <dd className="font-mono tabular-nums">
                  {fmtValue(row.used, row.unit)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">Remaining</dt>
                <dd
                  className={cn(
                    "font-mono text-base font-semibold tabular-nums",
                    row.remaining == null && "font-normal text-muted-foreground",
                  )}
                >
                  {fmtValue(row.remaining, row.unit)}
                </dd>
              </div>
            </dl>
            <UsageIndicator
              given={row.given}
              used={row.used}
              remaining={row.remaining}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function UsagePage() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJson<UsageResponse>("/api/usage");
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Usage</h2>
          <p className="text-sm text-muted-foreground">
            How much you have, how much you used, and what remains.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void load()}
        >
          <RefreshCwIcon className="size-3.5" />
          Refresh
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {data?.creditsWarning ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {data.creditsWarning}
        </p>
      ) : null}
      {data && !data.configured ? (
        <p className="text-sm text-muted-foreground">
          Set <code className="text-xs">AIRTABLE_USAGE_EVENTS_TABLE</code> to
          persist Airtable/R2 usage. ScrapeCreators remaining still loads live.
        </p>
      ) : null}
      {data?.warning ? (
        <p className="text-sm text-muted-foreground">{data.warning}</p>
      ) : null}

      {loading && !data ? (
        <div className="grid gap-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : null}

      {data?.services?.length ? (
        <div className="grid gap-3">
          {data.services.map((row) => (
            <ServiceCard key={row.service} row={row} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
