import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { fetchJson } from "@/lib/api";

type ProviderName = "scrapecreators" | "apify";

type ProviderStatus = {
  name: ProviderName;
  keyConfigured: boolean;
  lastResult: { status: "ok" | "402" | "401" | "429" | "error"; at: string } | null;
  credits: { remaining: number | null } | null;
};

type ProvidersResponse = {
  ok: boolean;
  primary: ProviderName;
  fallback: ProviderName | "none";
  autoSwitch: boolean;
  dbProvider: "supabase" | "airtable";
  providers: ProviderStatus[];
};

type TestResponse = {
  ok: boolean;
  name: ProviderName;
  status: "ok" | "402" | "401" | "429" | "error";
  at: string;
  message: string;
  credits: { remaining: number | null } | null;
};

const LABELS: Record<ProviderName, string> = {
  scrapecreators: "ScrapeCreators",
  apify: "Apify",
};

function other(name: ProviderName): ProviderName {
  return name === "apify" ? "scrapecreators" : "apify";
}

export function ProvidersSection() {
  const [primary, setPrimary] = useState<ProviderName>("scrapecreators");
  const [fallback, setFallback] = useState<ProviderName | "none">("apify");
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [dbProvider, setDbProvider] = useState<"supabase" | "airtable">("supabase");
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<ProviderName | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  function apply(data: ProvidersResponse) {
    setPrimary(data.primary);
    setFallback(data.fallback);
    setAutoSwitch(data.autoSwitch);
    setDbProvider(data.dbProvider);
    setProviders(data.providers);
  }

  useEffect(() => {
    let cancelled = false;
    fetchJson<ProvidersResponse>("/api/settings/providers")
      .then((data) => {
        if (!cancelled) apply(data);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        if (!cancelled) toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(next: {
    primary: ProviderName;
    fallback: ProviderName | "none";
    autoSwitch: boolean;
    dbProvider: "supabase" | "airtable";
  }) {
    setSaving(true);
    try {
      const data = await fetchJson<ProvidersResponse>("/api/settings/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      apply(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function onTest(name: ProviderName) {
    setTesting(name);
    setTestMessage(null);
    try {
      const data = await fetchJson<TestResponse>(
        `/api/settings/providers/${name}/test`,
        { method: "POST" },
      );
      setProviders((current) =>
        current.map((row) =>
          row.name === name
            ? {
                ...row,
                lastResult: { status: data.status, at: data.at },
                credits: data.credits,
              }
            : row,
        ),
      );
      setTestMessage(`${LABELS[name]}: ${data.status}${data.message && data.message !== "ok" ? ` · ${data.message}` : ""}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setTestMessage(message);
      toast.error(message);
    } finally {
      setTesting(null);
    }
  }

  const fallbackChoices: Array<ProviderName | "none"> = [other(primary), "none"];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Providers</CardTitle>
        <CardDescription>
          Scraper order and the catalog database. Changes apply on the next request.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="scrape-primary">Primary scraper</Label>
            <Select
              value={primary}
              disabled={loading || saving}
              onValueChange={(value) => {
                const next = value as ProviderName;
                const nextFallback = fallback === next ? other(next) : fallback;
                setPrimary(next);
                setFallback(nextFallback);
                void save({
                  primary: next,
                  fallback: nextFallback,
                  autoSwitch,
                  dbProvider,
                });
              }}
            >
              <SelectTrigger id="scrape-primary" className="w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="scrapecreators">ScrapeCreators</SelectItem>
                <SelectItem value="apify">Apify</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="scrape-fallback">Fallback scraper</Label>
            <Select
              value={fallbackChoices.includes(fallback) ? fallback : "none"}
              disabled={loading || saving}
              onValueChange={(value) => {
                const next = value as ProviderName | "none";
                setFallback(next);
                void save({ primary, fallback: next, autoSwitch, dbProvider });
              }}
            >
              <SelectTrigger id="scrape-fallback" className="w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={other(primary)}>{LABELS[other(primary)]}</SelectItem>
                <SelectItem value="none">None</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="scrape-auto-switch">Auto-switch if the primary fails</Label>
            <Switch
              id="scrape-auto-switch"
              checked={autoSwitch}
              disabled={loading || saving}
              onCheckedChange={(checked) => {
                setAutoSwitch(checked);
                void save({ primary, fallback, autoSwitch: checked, dbProvider });
              }}
            />
          </div>
        </div>

        <div className="space-y-3">
          {providers.map((row) => (
            <div
              key={row.name}
              className="flex flex-col gap-2 rounded-lg border border-border px-3 py-3 text-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{LABELS[row.name]}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading || testing != null}
                  onClick={() => void onTest(row.name)}
                >
                  {testing === row.name ? "Testing…" : "Test"}
                </Button>
              </div>
              <div className="text-muted-foreground">
                Key configured: {row.keyConfigured ? "yes" : "no"}
              </div>
              <div className="text-muted-foreground">
                Last result:{" "}
                {row.lastResult
                  ? `${row.lastResult.status} · ${new Date(row.lastResult.at).toLocaleString()}`
                  : "—"}
              </div>
              <div className="text-muted-foreground">
                Credits:{" "}
                {row.credits == null
                  ? "—"
                  : row.credits.remaining == null
                    ? "unavailable"
                    : row.credits.remaining.toLocaleString()}
              </div>
            </div>
          ))}
          {testMessage ? <p className="text-sm text-muted-foreground">{testMessage}</p> : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="db-provider">Database</Label>
          <Select
            value={dbProvider}
            disabled={loading || saving}
            onValueChange={(value) => {
              const next = value as "supabase" | "airtable";
              setDbProvider(next);
              void save({ primary, fallback, autoSwitch, dbProvider: next });
            }}
          >
            <SelectTrigger id="db-provider" className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="supabase">Supabase</SelectItem>
              <SelectItem value="airtable">Airtable</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">Switching does not move data.</p>
        </div>
      </CardContent>
    </Card>
  );
}
