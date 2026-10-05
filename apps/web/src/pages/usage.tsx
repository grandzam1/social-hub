import { useCallback, useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
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

type ServiceUsage = {
  key?: string;
  service: string;
  unit: string;
  metrics?: string[];
  given: number | null;
  used: number | null;
  remaining: number | null;
  source: string;
  detail?: string;
};

type UsageResponse = {
  ok: boolean;
  configured: boolean;
  warning?: string;
  creditsWarning?: string;
  services: ServiceUsage[];
  error?: string;
};

function fmtValue(n: number | null, unit: string) {
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
    unit === "credits" || unit === "requests" || unit === "count"
      ? unit === "count"
        ? "requests"
        : unit
      : unit;
  const text =
    Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `${text} ${label}`.trim();
}

function seriesNote(row: ServiceUsage) {
  if (row.detail) return row.detail;
  const what =
    row.unit === "credits"
      ? "Credits"
      : row.unit === "requests" || row.unit === "count"
        ? "Requests"
        : row.unit === "bytes"
          ? "Stored bytes"
          : row.metrics?.join(", ") || row.unit;
  if (row.given == null && row.remaining == null) {
    return `${what}. This is a running total. Record an allowance on the same service and unit to show what remains.`;
  }
  if (row.source === "live") return `${what} from the provider account.`;
  return `${what} from recorded usage.`;
}

function ProgressBar({
  given,
  used,
  remaining,
}: {
  given: number | null;
  used: number | null;
  remaining: number | null;
}) {
  // Only draw a bar when we have a real available amount and used/remaining.
  if (given == null || given <= 0 || used == null || remaining == null) {
    return null;
  }
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

function ServiceCard({ row }: { row: ServiceUsage }) {
  const hasBalance =
    row.given != null || row.remaining != null || row.used != null;
  const storage = row.unit === "bytes" && row.given != null && row.used != null;
  const usedPct =
    storage && row.given! > 0
      ? Math.min(100, Math.max(0, (row.used! / row.given!) * 100))
      : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{storage ? "Storage" : row.service}</CardTitle>
        <CardDescription className="text-xs">{seriesNote(row)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasBalance ? (
          <p className="text-sm text-muted-foreground">No data yet.</p>
        ) : storage ? (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="text-lg font-semibold tabular-nums">
                {fmtValue(row.used, "bytes")}
              </span>
              <span className="text-muted-foreground">
                {" "}
                of {fmtValue(row.given, "bytes")} used
              </span>
            </p>
            <div
              className="h-2.5 overflow-hidden rounded-full bg-muted"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={row.given ?? 0}
              aria-valuenow={row.used ?? 0}
              aria-label="Storage used"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${usedPct}%` }}
              />
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">
              {row.used! > row.given!
                ? "Over the included storage"
                : `${Math.round(usedPct)}% of included storage`}
            </p>
          </div>
        ) : (
          <>
            <dl className="grid gap-2 text-sm">
              {row.given != null ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Given</dt>
                  <dd className="font-mono tabular-nums">
                    {fmtValue(row.given, row.unit)}
                  </dd>
                </div>
              ) : null}
              {row.used != null ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Used</dt>
                  <dd className="font-mono tabular-nums">
                    {fmtValue(row.used, row.unit)}
                  </dd>
                </div>
              ) : null}
              {row.remaining != null ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Remaining</dt>
                  <dd className="font-mono text-base font-semibold tabular-nums">
                    {fmtValue(row.remaining, row.unit)}
                  </dd>
                </div>
              ) : null}
            </dl>
            <ProgressBar
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
          Usage events are not being stored yet. Provider balances still load
          live.
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
            <ServiceCard key={row.key ?? `${row.service}:${row.unit}`} row={row} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
