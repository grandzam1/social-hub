import { Button } from "@/components/ui/button";
import type { DownloadStatus } from "@/lib/download-file";
import { cn } from "@/lib/utils";

export function DownloadProgress({
  status,
  percent,
  label,
  total = 0,
  onRetry,
}: {
  status: DownloadStatus;
  percent: number;
  label: string;
  total?: number;
  onRetry?: () => void;
}) {
  const known = total > 0;
  const showPercent =
    known &&
    (status === "downloading" || status === "saving" || status === "done");
  const shown =
    status === "done" || (status === "saving" && known) ? 100 : percent;
  const indeterminate =
    status === "preparing" ||
    (status === "downloading" && !known) ||
    (status === "saving" && !known);

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p
          className={cn(
            "text-sm",
            status === "failed" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {label}
          {showPercent ? ` ${shown}%` : ""}
        </p>
        {status === "failed" && onRetry ? (
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : shown}
        aria-valuetext={indeterminate ? label : `${shown}%`}
        aria-label={label}
      >
        {indeterminate ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
        ) : (
          <div
            className={cn(
              "h-full rounded-full transition-all",
              status === "failed" ? "bg-destructive" : "bg-primary",
            )}
            style={{ width: `${Math.max(0, Math.min(100, shown))}%` }}
          />
        )}
      </div>
    </div>
  );
}
