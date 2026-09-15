import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

type CreditsResponse = {
  ok: boolean;
  remaining?: number;
  history?: Array<{
    endpoint?: string;
    credits?: number;
    created_at?: string;
  }>;
  error?: string;
};

export function CreditsChip() {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<CreditsResponse["history"]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchJson<CreditsResponse>("/api/credits")
      .then((data) => {
        if (!cancelled && data.ok) setRemaining(data.remaining ?? null);
      })
      .catch(() => {
        if (!cancelled) setRemaining(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function openHistory() {
    setOpen(true);
    try {
      const data = await fetchJson<CreditsResponse>("/api/credits/history");
      if (data.ok) {
        if (data.remaining != null) setRemaining(data.remaining);
        setHistory(data.history || []);
      }
    } catch {
      setHistory([]);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-2 font-normal"
        onClick={() => void openHistory()}
      >
        <span className="text-muted-foreground">credits</span>
        <Badge variant="secondary" className="font-mono tabular-nums">
          {remaining == null ? "—" : remaining.toLocaleString()}
        </Badge>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Charge history</SheetTitle>
          </SheetHeader>
          <ScrollArea className="mt-4 h-[calc(100vh-8rem)] pr-3">
            <ul className="space-y-3 text-sm">
              {(history || []).length === 0 ? (
                <li className="text-muted-foreground">No recent charges.</li>
              ) : (
                (history || []).map((row, i) => (
                  <li
                    key={`${row.created_at || i}-${row.endpoint || i}`}
                    className="rounded-lg border border-border bg-card p-3"
                  >
                    <div className="font-medium">{row.endpoint || "charge"}</div>
                    <div className="mt-1 flex justify-between text-muted-foreground">
                      <span>{row.created_at || "—"}</span>
                      <span className="font-mono">
                        −{row.credits ?? "?"}
                      </span>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function bumpCredits(remaining?: number | null) {
  if (remaining == null) return;
  window.dispatchEvent(
    new CustomEvent("social-hub:credits", { detail: { remaining } }),
  );
}
